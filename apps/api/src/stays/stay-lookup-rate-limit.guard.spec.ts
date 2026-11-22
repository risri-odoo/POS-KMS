import { describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus, type ExecutionContext } from '@nestjs/common';
import { StayLookupRateLimitGuard } from './stay-lookup-rate-limit.guard.js';

function context(ip: string) {
  const setHeader = vi.fn();
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ ip }), getResponse: () => ({ setHeader }) }),
  } as unknown as ExecutionContext;
  return { ctx, setHeader };
}

function guard(max = 30, windowMs = 60_000) {
  let now = 1_000_000;
  const g = new StayLookupRateLimitGuard({ max, windowMs, now: () => now });
  return { g, advance: (ms: number) => (now += ms) };
}

describe('StayLookupRateLimitGuard', () => {
  it('allows 30 lookups per minute from one IP, then answers 429 with Retry-After', () => {
    const { g } = guard();
    const { ctx, setHeader } = context('10.0.0.1');
    for (let i = 0; i < 30; i++) expect(g.canActivate(ctx)).toBe(true);

    const error = (() => {
      try {
        g.canActivate(ctx);
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('counts each IP separately', () => {
    const { g } = guard(2);
    const a = context('10.0.0.1').ctx;
    const b = context('10.0.0.2').ctx;
    g.canActivate(a);
    g.canActivate(a);
    expect(() => g.canActivate(a)).toThrow(HttpException);
    expect(g.canActivate(b)).toBe(true);
  });

  it('starts a fresh window once the minute has passed', () => {
    const { g, advance } = guard(2);
    const { ctx } = context('10.0.0.1');
    g.canActivate(ctx);
    g.canActivate(ctx);
    expect(() => g.canActivate(ctx)).toThrow(HttpException);
    advance(60_000);
    expect(g.canActivate(ctx)).toBe(true);
  });

  it('defaults to 30 per 60 s when no options or env are set', () => {
    const before = { max: process.env['STAY_LOOKUP_RATE_LIMIT_MAX'], win: process.env['STAY_LOOKUP_RATE_LIMIT_WINDOW_MS'] };
    delete process.env['STAY_LOOKUP_RATE_LIMIT_MAX'];
    delete process.env['STAY_LOOKUP_RATE_LIMIT_WINDOW_MS'];
    try {
      const g = new StayLookupRateLimitGuard();
      const { ctx } = context('10.0.0.9');
      for (let i = 0; i < 30; i++) g.canActivate(ctx);
      expect(() => g.canActivate(ctx)).toThrow(HttpException);
    } finally {
      if (before.max !== undefined) process.env['STAY_LOOKUP_RATE_LIMIT_MAX'] = before.max;
      if (before.win !== undefined) process.env['STAY_LOOKUP_RATE_LIMIT_WINDOW_MS'] = before.win;
    }
  });
});
