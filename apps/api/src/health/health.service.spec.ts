import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { Db } from '../database/database.module.js';
import type { HaipQueue } from '../haip/haip-queue.service.js';
import { HealthService } from './health.service.js';

const never = () => new Promise<never>(() => undefined);

function service(db: () => Promise<unknown>, redis: () => Promise<'up' | 'not_used'>, timeoutMs = 50) {
  return new HealthService({ execute: vi.fn(db) } as unknown as Db, { ping: vi.fn(redis) } as unknown as HaipQueue, timeoutMs);
}

describe('HealthService.readiness', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('ok when the database answers and Redis is up', async () => {
    await expect(service(() => Promise.resolve([]), () => Promise.resolve('up')).readiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('ok without Redis when the HAIP bridge is off', async () => {
    await expect(service(() => Promise.resolve([]), () => Promise.resolve('not_used')).readiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'not_used' },
    });
  });

  it('unavailable when the database fails; the reason goes to the log only', async () => {
    const result = await service(() => Promise.reject(new Error('ECONNREFUSED 10.0.0.5:5432 password authentication failed')), () => Promise.resolve('up')).readiness();
    expect(result).toEqual({ status: 'unavailable', checks: { database: 'down', redis: 'up' } });
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('database is down: ECONNREFUSED'));
  });

  it('unavailable when Redis is down', async () => {
    const result = await service(() => Promise.resolve([]), () => Promise.reject(new Error('Connection is closed.'))).readiness();
    expect(result).toEqual({ status: 'unavailable', checks: { database: 'up', redis: 'down' } });
  });

  it('a check that hangs counts as down after the timeout, and doesn’t hang the probe', async () => {
    const started = Date.now();
    const result = await service(never, never, 50).readiness();
    expect(result).toEqual({ status: 'unavailable', checks: { database: 'down', redis: 'down' } });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no answer within 50 ms'));
  });
});
