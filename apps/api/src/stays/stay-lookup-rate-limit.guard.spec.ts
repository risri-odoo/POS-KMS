import { describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus, Logger, type ExecutionContext } from '@nestjs/common';
import type { HaipQueue } from '../haip/haip-queue.service.js';
import { RATE_LIMIT_KEY_PREFIX, RedisRateLimitStore, type RedisCounterCommands } from './rate-limit-store.js';
import { StayLookupRateLimitGuard, rateLimitKey } from './stay-lookup-rate-limit.guard.js';

/** A request from `ip`, signed in as `sub` (or with login off when sub is undefined). */
function context(ip: string, sub?: string) {
  const setHeader = vi.fn();
  const request = { ip, ...(sub ? { auth: { sub } } : {}) };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader }) }),
  } as unknown as ExecutionContext;
  return { ctx, setHeader };
}

function guard(max = 30, windowMs = 60_000, queue?: Partial<HaipQueue>) {
  let now = 1_000_000;
  const g = new StayLookupRateLimitGuard(queue as HaipQueue | undefined, { max, windowMs, now: () => now });
  return { g, advance: (ms: number) => (now += ms) };
}

const refused = (g: StayLookupRateLimitGuard, ctx: ExecutionContext) =>
  g.canActivate(ctx).then(
    () => undefined,
    (e: unknown) => e,
  );

/** An in-memory stand-in for Redis INCR / PTTL / PEXPIRE, with a clock. */
function fakeRedis(clock: () => number) {
  const keys = new Map<string, { value: number; expiresAt: number | null }>();
  const live = (k: string) => {
    const e = keys.get(k);
    if (e && e.expiresAt !== null && clock() >= e.expiresAt) keys.delete(k);
    return keys.get(k);
  };
  const pexpire = vi.fn((k: string, ms: number) => {
    const e = live(k);
    if (e) e.expiresAt = clock() + ms;
    return Promise.resolve(e ? 1 : 0);
  });
  const redis: RedisCounterCommands & { keys: typeof keys; pexpireMock: typeof pexpire } = {
    keys,
    pexpireMock: pexpire,
    incr: vi.fn((k: string) => {
      const e = live(k) ?? { value: 0, expiresAt: null };
      e.value += 1;
      keys.set(k, e);
      return Promise.resolve(e.value);
    }),
    pttl: vi.fn((k: string) => {
      const e = live(k);
      return Promise.resolve(!e ? -2 : e.expiresAt === null ? -1 : e.expiresAt - clock());
    }),
    pexpire,
  };
  return redis;
}

describe('rateLimitKey', () => {
  it('counts the signed-in user, not the IP; the IP only with login off', () => {
    expect(rateLimitKey({ ip: '203.0.113.7', auth: { sub: 'u-1' } as never })).toBe('user:u-1');
    expect(rateLimitKey({ ip: '203.0.113.7' })).toBe('ip:203.0.113.7');
    expect(rateLimitKey({ socket: { remoteAddress: '::1' } })).toBe('ip:::1');
  });
});

describe('StayLookupRateLimitGuard (in memory)', () => {
  it('allows 30 lookups per minute per user, then answers 429 with Retry-After', async () => {
    const { g } = guard();
    const { ctx, setHeader } = context('10.0.0.1', 'staff-1');
    for (let i = 0; i < 30; i++) expect(await g.canActivate(ctx)).toBe(true);
    const error = await refused(g, ctx);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('two staff behind the same hotel IP each get their own limit', async () => {
    const { g } = guard(2);
    const alice = context('203.0.113.7', 'alice').ctx;
    const bob = context('203.0.113.7', 'bob').ctx;
    await g.canActivate(alice);
    await g.canActivate(alice);
    expect(await refused(g, alice)).toBeInstanceOf(HttpException);
    expect(await g.canActivate(bob)).toBe(true);
  });

  it('one user on two IPs shares one limit', async () => {
    const { g } = guard(2);
    await g.canActivate(context('10.0.0.1', 'alice').ctx);
    await g.canActivate(context('10.0.0.2', 'alice').ctx);
    expect(await refused(g, context('10.0.0.3', 'alice').ctx)).toBeInstanceOf(HttpException);
  });

  it('with login off, counts per IP', async () => {
    const { g } = guard(1);
    await g.canActivate(context('10.0.0.1').ctx);
    expect(await refused(g, context('10.0.0.1').ctx)).toBeInstanceOf(HttpException);
    expect(await g.canActivate(context('10.0.0.2').ctx)).toBe(true);
  });

  it('starts a fresh window once the minute has passed', async () => {
    const { g, advance } = guard(2);
    const { ctx } = context('10.0.0.1', 'alice');
    await g.canActivate(ctx);
    await g.canActivate(ctx);
    expect(await refused(g, ctx)).toBeInstanceOf(HttpException);
    advance(60_000);
    expect(await g.canActivate(ctx)).toBe(true);
  });

  it('defaults to 30 per 60 s when no options or env are set', async () => {
    const before = { max: process.env['STAY_LOOKUP_RATE_LIMIT_MAX'], win: process.env['STAY_LOOKUP_RATE_LIMIT_WINDOW_MS'] };
    delete process.env['STAY_LOOKUP_RATE_LIMIT_MAX'];
    delete process.env['STAY_LOOKUP_RATE_LIMIT_WINDOW_MS'];
    const g = new StayLookupRateLimitGuard();
    const { ctx, setHeader } = context('10.0.0.9', 'carol');
    for (let i = 0; i < 30; i++) await g.canActivate(ctx);
    expect(await refused(g, ctx)).toBeInstanceOf(HttpException);
    expect(Number(setHeader.mock.calls[0]![1])).toBeLessThanOrEqual(60);
    if (before.max !== undefined) process.env['STAY_LOOKUP_RATE_LIMIT_MAX'] = before.max;
    if (before.win !== undefined) process.env['STAY_LOOKUP_RATE_LIMIT_WINDOW_MS'] = before.win;
  });
});

describe('StayLookupRateLimitGuard (Redis, when the HAIP bridge is on)', () => {
  it('counts in Redis, so every API process shares the limit', async () => {
    let now = 1_000_000;
    const redis = fakeRedis(() => now);
    const queue = { redisCounterClient: vi.fn().mockResolvedValue(redis) };
    const make = () => new StayLookupRateLimitGuard(queue as unknown as HaipQueue, { max: 2, windowMs: 60_000, now: () => now });
    // Two guards = two API processes.
    const first = make();
    const second = make();
    await first.canActivate(context('10.0.0.1', 'alice').ctx);
    await second.canActivate(context('10.0.0.1', 'alice').ctx);
    expect(await refused(first, context('10.0.0.1', 'alice').ctx)).toBeInstanceOf(HttpException);
    expect(redis.keys.get(`${RATE_LIMIT_KEY_PREFIX}user:alice`)?.value).toBe(3);
    now += 60_000;
    expect(await second.canActivate(context('10.0.0.1', 'alice').ctx)).toBe(true);
  });

  it('if Redis fails, counts in memory instead (never blocks a lookup) and warns', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const broken = { incr: vi.fn().mockRejectedValue(new Error('Connection is closed.')), pttl: vi.fn(), pexpire: vi.fn() };
    const queue = { redisCounterClient: vi.fn().mockResolvedValue(broken) };
    const { g } = guard(1, 60_000, queue as unknown as HaipQueue);
    expect(await g.canActivate(context('10.0.0.1', 'alice').ctx)).toBe(true);
    expect(await refused(g, context('10.0.0.1', 'alice').ctx)).toBeInstanceOf(HttpException); // the memory count still limits
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Redis failed, counting in memory'));
  });

  it('with the bridge off (no Redis client), counts in memory', async () => {
    const queue = { redisCounterClient: vi.fn().mockResolvedValue(null) };
    const { g } = guard(1, 60_000, queue as unknown as HaipQueue);
    await g.canActivate(context('10.0.0.1', 'alice').ctx);
    expect(await refused(g, context('10.0.0.1', 'alice').ctx)).toBeInstanceOf(HttpException);
  });
});

describe('RedisRateLimitStore', () => {
  it('sets the window’s expiry on the first hit only', async () => {
    const redis = fakeRedis(() => 0);
    const store = new RedisRateLimitStore(redis);
    expect(await store.hit('user:a', 60_000, 0)).toEqual({ count: 1, resetAt: 60_000 });
    expect(await store.hit('user:a', 60_000, 0)).toEqual({ count: 2, resetAt: 60_000 });
    expect(redis.pexpireMock).toHaveBeenCalledTimes(1);
  });

  it('gives a key found without an expiry one, so it can never count forever', async () => {
    const redis = fakeRedis(() => 0);
    redis.keys.set(`${RATE_LIMIT_KEY_PREFIX}user:a`, { value: 5, expiresAt: null });
    const store = new RedisRateLimitStore(redis);
    expect(await store.hit('user:a', 60_000, 0)).toEqual({ count: 6, resetAt: 60_000 });
    expect(redis.pexpireMock).toHaveBeenCalledWith(`${RATE_LIMIT_KEY_PREFIX}user:a`, 60_000);
  });
});
