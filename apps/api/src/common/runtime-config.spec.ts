import { describe, expect, it } from 'vitest';
import { corsOrigins, databaseUrl, productionConfigProblems, redisUrl } from './runtime-config.js';

const PROD_DB = 'postgres://pos_app:s3cret@db.internal:5432/stayx_pos';

describe('development (NODE_ENV not production)', () => {
  it('keeps the local docker-compose defaults', () => {
    expect(databaseUrl({})).toBe('postgres://stayx:stayx@localhost:5433/stayx_pos');
    expect(redisUrl({ NODE_ENV: 'development' })).toBe('redis://localhost:6380');
    expect(corsOrigins({})).toContain('http://localhost:5180');
    expect(productionConfigProblems({})).toEqual([]);
  });

  it('uses what is set', () => {
    expect(databaseUrl({ DATABASE_URL: ' postgres://a:b@h/d ' })).toBe('postgres://a:b@h/d');
    expect(corsOrigins({ CORS_ORIGINS: 'https://pos.example.com, https://kms.example.com,' })).toEqual(['https://pos.example.com', 'https://kms.example.com']);
  });
});

describe('production', () => {
  const prod = (env: Record<string, string> = {}) => ({ NODE_ENV: 'production', ...env });

  it('has no defaults: database and CORS must be set', () => {
    expect(() => databaseUrl(prod())).toThrow('DATABASE_URL must be set when NODE_ENV=production');
    expect(() => corsOrigins(prod())).toThrow('CORS_ORIGINS must be set');
    expect(() => redisUrl(prod())).toThrow('REDIS_URL must be set');
  });

  it('refuses the development credentials, however written', () => {
    for (const url of ['postgres://stayx:stayx@localhost:5433/stayx_pos', 'postgresql://stayx:stayx@db.internal:5432/pos']) {
      expect(() => databaseUrl(prod({ DATABASE_URL: url }))).toThrow('development credentials');
    }
    expect(databaseUrl(prod({ DATABASE_URL: PROD_DB }))).toBe(PROD_DB);
  });

  it('lists every problem at once, so one failed start shows them all', () => {
    expect(productionConfigProblems(prod())).toEqual([
      'DATABASE_URL must be set when NODE_ENV=production (there is no production default)',
      'CORS_ORIGINS must be set when NODE_ENV=production (there is no production default)',
    ]);
  });

  it('needs no Redis or HAIP address while the HAIP bridge is off', () => {
    expect(productionConfigProblems(prod({ DATABASE_URL: PROD_DB, CORS_ORIGINS: 'https://pos.example.com' }))).toEqual([]);
  });

  it('with the HAIP bridge on, needs Redis and HAIP’s real address too', () => {
    const base = prod({ DATABASE_URL: PROD_DB, CORS_ORIGINS: 'https://pos.example.com', HAIP_BRIDGE_ENABLED: 'true' });
    expect(productionConfigProblems(base)).toEqual([
      'REDIS_URL must be set when NODE_ENV=production (there is no production default)',
      'HAIP_API_URL must be set when NODE_ENV=production and HAIP_BRIDGE_ENABLED=true',
    ]);
    expect(productionConfigProblems({ ...base, REDIS_URL: 'rediss://cache.internal:6380', HAIP_API_URL: 'https://haip.example.com/api/v1' })).toEqual([]);
  });
});

describe('allowOrigin (socket CORS, read per request)', () => {
  it('allows the configured origins and non-browser requests, refuses others', async () => {
    const { allowOrigin } = await import('./cors.js');
    const ask = (origin: string | undefined) => new Promise((resolve) => allowOrigin(origin, (_e, allow) => resolve(allow)));
    expect(await ask('http://localhost:5181')).toBe(true);
    expect(await ask(undefined)).toBe(true);
    expect(await ask('https://evil.example')).toBe(false);
  });
});
