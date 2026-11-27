/** One counted hit: how many in the current window, and when the window ends. */
export interface RateLimitHit {
  count: number;
  resetAt: number;
}

/** Fixed-window counters for the stay-lookup limit. */
export interface RateLimitStore {
  hit(key: string, windowMs: number, now: number): Promise<RateLimitHit>;
}

/** Per process; the development fallback, and the fallback when Redis fails. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, RateLimitHit>();

  hit(key: string, windowMs: number, now: number): Promise<RateLimitHit> {
    const entry = this.hits.get(key);
    if (!entry || now >= entry.resetAt) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.hits.set(key, fresh);
      this.sweep(now);
      return Promise.resolve({ ...fresh });
    }
    entry.count += 1;
    return Promise.resolve({ ...entry });
  }

  private sweep(now: number): void {
    if (this.hits.size < 10_000) return;
    for (const [k, v] of this.hits) if (now >= v.resetAt) this.hits.delete(k);
  }
}

/** The three Redis commands the counter needs (ioredis signatures). */
export interface RedisCounterCommands {
  incr(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
}

/** True when `client` really has the commands (BullMQ only types a minimal client). */
export function hasCounterCommands(client: unknown): client is RedisCounterCommands {
  const c = client as Partial<Record<keyof RedisCounterCommands, unknown>> | null;
  return !!c && typeof c.incr === 'function' && typeof c.pttl === 'function' && typeof c.pexpire === 'function';
}

export const RATE_LIMIT_KEY_PREFIX = 'stayx:stay-lookup:';

/**
 * Shared by every API process, so a limit holds however many run. Fixed window: INCR the
 * key and give it an expiry on the first hit. A key found without an expiry (say the
 * process died between INCR and PEXPIRE) gets one, so it can never count forever.
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: RedisCounterCommands) {}

  async hit(key: string, windowMs: number, now: number): Promise<RateLimitHit> {
    const redisKey = RATE_LIMIT_KEY_PREFIX + key;
    const count = await this.redis.incr(redisKey);
    let ttl = await this.redis.pttl(redisKey);
    if (count === 1 || ttl < 0) {
      await this.redis.pexpire(redisKey, windowMs);
      ttl = windowMs;
    }
    return { count, resetAt: now + ttl };
  }
}
