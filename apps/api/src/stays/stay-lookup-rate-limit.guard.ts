import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';

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

/**
 * Per-IP limit on GET /stays/lookup (default 30 per minute), to slow down anyone
 * walking room numbers to collect guest names.
 *
 * A second line behind staff login (only pos_staff and pos_manager may call the
 * lookup, for their own hotels; INTEGRATION_DESIGN.md §8.4). Known limits: counts
 * are in memory, per process, and keyed by the socket address, so behind a proxy
 * every client shares one IP. Keying by the signed-in user would now be possible.
 */
@Injectable()
export class StayLookupRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly options: RateLimitOptions;

  constructor(@Optional() @Inject(STAY_LOOKUP_RATE_LIMIT) options?: Partial<RateLimitOptions>) {
    this.options = { ...fromEnv(), ...options };
  }

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<{ ip?: string; socket?: { remoteAddress?: string } }>();
    const key = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const now = this.options.now();

    const entry = this.hits.get(key);
    if (!entry || now >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.options.windowMs });
      this.sweep(now);
      return true;
    }
    entry.count += 1;
    if (entry.count > this.options.max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      http.getResponse<{ setHeader?: (name: string, value: string) => void }>().setHeader?.('Retry-After', String(retryAfter));
      throw new HttpException('Too many stay lookups. Wait a moment and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private sweep(now: number): void {
    if (this.hits.size < 10_000) return;
    for (const [k, v] of this.hits) if (now >= v.resetAt) this.hits.delete(k);
  }
}
