import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/token-verifier.js';
import { HaipQueue } from '../haip/haip-queue.service.js';
import { throttledLog } from '../haip/throttled-log.js';
import { MemoryRateLimitStore, RedisRateLimitStore, type RateLimitStore } from './rate-limit-store.js';

export const STAY_LOOKUP_RATE_LIMIT = Symbol('STAY_LOOKUP_RATE_LIMIT');

export interface RateLimitOptions {
  max: number;
  windowMs: number;
  now: () => number;
}

function fromEnv(env: NodeJS.ProcessEnv = process.env): RateLimitOptions {
  const max = Number(env['STAY_LOOKUP_RATE_LIMIT_MAX']);
  const windowMs = Number(env['STAY_LOOKUP_RATE_LIMIT_WINDOW_MS']);
  return {
    max: Number.isInteger(max) && max > 0 ? max : 30,
    windowMs: Number.isInteger(windowMs) && windowMs > 0 ? windowMs : 60_000,
    now: () => Date.now(),
  };
}

interface LookupRequest {
  auth?: AuthPrincipal;
  ip?: string;
  socket?: { remoteAddress?: string };
}

/**
 * Who a lookup is counted against: the signed-in user (their token's sub). All the
 * terminals at one hotel usually share one public IP, so a per-IP limit let one busy
 * terminal block the others, and gave one person on several IPs several limits. The IP
 * is used only with login off (local development).
 */
export function rateLimitKey(req: LookupRequest): string {
  if (req.auth?.sub) return `user:${req.auth.sub}`;
  return `ip:${req.ip ?? req.socket?.remoteAddress ?? 'unknown'}`;
}

/**
 * Limit on GET /stays/lookup (default 30 per minute per user), to slow down anyone walking
 * room numbers to collect guest names. A second line behind staff login (only pos_staff
 * and pos_manager may call the lookup, for their own hotels; INTEGRATION_DESIGN.md §8.4).
 *
 * Counts are in Redis when the HAIP bridge is on (shared by every API process), else in
 * memory. If Redis fails, the lookup is counted in memory instead: a Redis hiccup never
 * blocks staff from confirming a guest.
 */
@Injectable()
export class StayLookupRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(StayLookupRateLimitGuard.name);
  private readonly warn = throttledLog((m) => this.logger.warn(m));
  private readonly options: RateLimitOptions;
  private readonly memory = new MemoryRateLimitStore();
  private redis: RedisRateLimitStore | null = null;

  constructor(
    @Optional() private readonly haipQueue?: HaipQueue,
    @Optional() @Inject(STAY_LOOKUP_RATE_LIMIT) options?: Partial<RateLimitOptions>,
  ) {
    this.options = { ...fromEnv(), ...options };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const key = rateLimitKey(http.getRequest<LookupRequest>());
    const now = this.options.now();
    const { count, resetAt } = await this.count(key, now);
    if (count > this.options.max) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
      http.getResponse<{ setHeader?: (name: string, value: string) => void }>().setHeader?.('Retry-After', String(retryAfter));
      throw new HttpException('Too many stay lookups. Wait a moment and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private async count(key: string, now: number) {
    const store = await this.sharedStore();
    if (store) {
      try {
        return await store.hit(key, this.options.windowMs, now);
      } catch (error) {
        this.warn(`Stay-lookup limit: Redis failed, counting in memory for now: ${(error as Error)?.message ?? String(error)}`);
      }
    }
    return this.memory.hit(key, this.options.windowMs, now);
  }

  /** The Redis store when the HAIP bridge (and so Redis) is in use; null otherwise. */
  private async sharedStore(): Promise<RateLimitStore | null> {
    if (this.redis) return this.redis;
    const client = await this.haipQueue?.redisCounterClient().catch(() => null);
    if (client) this.redis = new RedisRateLimitStore(client);
    return this.redis;
  }
}
