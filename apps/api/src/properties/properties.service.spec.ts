import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../database/database.module.js';
import { HAIP_KEY_ENV_PATTERN, PropertiesService, haipApiKeyFor, type PropertyRecord } from './properties.service.js';

const A = 'a0000001-0000-4000-a000-000000000001';
const hotel = (overrides: Partial<PropertyRecord> = {}): PropertyRecord => ({
  id: A,
  name: 'Demo hotel',
  currencyCode: 'USD',
  timezone: 'America/New_York',
  haipApiKeyEnv: 'HAIP_KEY_DEMO',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

/** A db whose properties query answers from `rows()`, counting queries. */
function fakeDb(rows: () => PropertyRecord[]) {
  const queries = vi.fn();
  const db = { select: () => ({ from: () => ({ where: () => (queries(), Promise.resolve(rows())) }) }) } as unknown as Db;
  return { db, queries };
}

describe('PropertiesService.find', () => {
  it('returns an active hotel and reuses the answer for the cache time', async () => {
    let now = 1_000;
    const { db, queries } = fakeDb(() => [hotel()]);
    const service = new PropertiesService(db, 30_000, () => now);
    expect(await service.find(A)).toMatchObject({ id: A, name: 'Demo hotel' });
    now += 29_000;
    await service.find(A);
    expect(queries).toHaveBeenCalledTimes(1);
    now += 2_000;
    await service.find(A);
    expect(queries).toHaveBeenCalledTimes(2);
  });

  it('treats an inactive hotel like an unknown one', async () => {
    const { db } = fakeDb(() => [hotel({ active: false })]);
    expect(await new PropertiesService(db, 30_000, () => 0).find(A)).toBeNull();
  });

  it('a hotel added by script is seen once the cached "unknown" expires', async () => {
    let now = 0;
    let rows: PropertyRecord[] = [];
    const { db } = fakeDb(() => rows);
    const service = new PropertiesService(db, 30_000, () => now);
    expect(await service.find(A)).toBeNull();
    rows = [hotel()];
    expect(await service.find(A)).toBeNull(); // still cached
    now += 30_001;
    expect(await service.find(A)).not.toBeNull();
  });
});

describe('haipApiKeyFor', () => {
  it('reads the key from the variable the hotel names', () => {
    expect(haipApiKeyFor(hotel(), { HAIP_KEY_DEMO: ' k-123 ' })).toEqual({ ok: true, apiKey: 'k-123' });
  });

  it('only ever reads HAIP_KEY_* variables, never another secret', () => {
    for (const name of ['DATABASE_URL', 'HAIP_SP_CLIENT_SECRET', 'haip_key_demo', 'HAIP_KEY_', 'HAIP_KEY_A-B']) {
      const result = haipApiKeyFor(hotel({ haipApiKeyEnv: name }), { [name]: 'secret' });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('secret');
    }
    expect(HAIP_KEY_ENV_PATTERN.test('HAIP_KEY_DEMO_2')).toBe(true);
  });

  it('explains a missing name or an unset variable without leaking anything', () => {
    expect(haipApiKeyFor(hotel({ haipApiKeyEnv: null }), {})).toEqual({ ok: false, reason: 'Demo hotel has no HAIP key configured' });
    expect(haipApiKeyFor(hotel(), { HAIP_KEY_DEMO: '  ' })).toEqual({ ok: false, reason: 'Demo hotel: HAIP_KEY_DEMO is not set' });
  });
});
