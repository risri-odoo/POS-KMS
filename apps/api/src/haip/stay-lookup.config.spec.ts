import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@nestjs/common';
import { FakeStayLookup } from './fake-stay-lookup.js';
import { createStayLookup, haipStayLookupOptions, loadStayLookupMode } from './stay-lookup.config.js';
import { HaipStayLookup } from './haip-stay-lookup.js';
import { NotConfiguredStayLookup } from './stay-lookup.js';

const quietLogger = () => ({ warn: vi.fn(), log: vi.fn() }) as unknown as Logger;

describe('loadStayLookupMode', () => {
  it('is not configured when HAIP_STAY_LOOKUP is unset or blank', () => {
    expect(loadStayLookupMode({})).toBe('not_configured');
    expect(loadStayLookupMode({ HAIP_STAY_LOOKUP: '  ' })).toBe('not_configured');
  });

  it('accepts fake outside production, in any case', () => {
    expect(loadStayLookupMode({ HAIP_STAY_LOOKUP: 'fake' })).toBe('fake');
    expect(loadStayLookupMode({ HAIP_STAY_LOOKUP: ' FAKE ', NODE_ENV: 'development' })).toBe('fake');
  });

  it('refuses fake when NODE_ENV=production', () => {
    expect(() => loadStayLookupMode({ HAIP_STAY_LOOKUP: 'fake', NODE_ENV: 'production' })).toThrow(
      'HAIP_STAY_LOOKUP=fake is not allowed when NODE_ENV=production',
    );
    expect(() => loadStayLookupMode({ HAIP_STAY_LOOKUP: 'fake', NODE_ENV: ' Production ' })).toThrow();
  });

  it('refuses unknown values instead of silently falling back', () => {
    expect(() => loadStayLookupMode({ HAIP_STAY_LOOKUP: 'keycloak' })).toThrow('HAIP_STAY_LOOKUP="keycloak" is not supported');
  });

  it('accepts haip, in production too', () => {
    expect(loadStayLookupMode({ HAIP_STAY_LOOKUP: 'haip', NODE_ENV: 'production' })).toBe('haip');
  });
});

describe('haipStayLookupOptions', () => {
  const full = {
    HAIP_STAY_LOOKUP: 'haip',
    HAIP_STAFF_API_URL: 'http://localhost:3001/api/v1/',
    HAIP_SP_TOKEN_URL: 'http://localhost:8080/realms/haip/protocol/openid-connect/token',
    HAIP_SP_CLIENT_ID: 'stayx-pos',
    HAIP_SP_CLIENT_SECRET: 'sp-secret-DO-NOT-LEAK',
  };

  it('reads the service-principal settings and trims the trailing slash', () => {
    expect(haipStayLookupOptions(full)).toEqual({
      apiUrl: 'http://localhost:3001/api/v1',
      tokenUrl: full.HAIP_SP_TOKEN_URL,
      clientId: 'stayx-pos',
      clientSecret: 'sp-secret-DO-NOT-LEAK',
    });
  });

  it('falls back to HAIP_API_URL when HAIP_STAFF_API_URL is unset', () => {
    const { HAIP_STAFF_API_URL: _unused, ...rest } = full;
    expect(haipStayLookupOptions({ ...rest, HAIP_API_URL: 'http://haip:3000/api/v1' }).apiUrl).toBe('http://haip:3000/api/v1');
  });

  it('names every missing setting, so the API refuses to start', () => {
    expect(() => haipStayLookupOptions({ HAIP_STAY_LOOKUP: 'haip' })).toThrow(
      'HAIP_STAY_LOOKUP=haip needs: HAIP_STAFF_API_URL, HAIP_SP_TOKEN_URL, HAIP_SP_CLIENT_ID, HAIP_SP_CLIENT_SECRET',
    );
    expect(() => createStayLookup({ ...full, HAIP_SP_CLIENT_SECRET: ' ' }, quietLogger())).toThrow('needs: HAIP_SP_CLIENT_SECRET');
  });

  it('never puts the secret in an error or the startup log', () => {
    const logger = { warn: vi.fn(), log: vi.fn() } as unknown as Logger;
    expect(createStayLookup(full, logger)).toBeInstanceOf(HaipStayLookup);
    const logged = JSON.stringify([(logger.log as ReturnType<typeof vi.fn>).mock.calls, (logger.warn as ReturnType<typeof vi.fn>).mock.calls]);
    expect(logged).not.toContain('DO-NOT-LEAK');
    try {
      haipStayLookupOptions({ ...full, HAIP_SP_CLIENT_ID: '' });
    } catch (e) {
      expect(String(e)).not.toContain('DO-NOT-LEAK');
    }
  });
});

describe('createStayLookup (the HaipModule provider factory)', () => {
  it('returns the not-configured lookup when unset, which answers not_configured', async () => {
    const lookup = createStayLookup({}, quietLogger());
    expect(lookup).toBeInstanceOf(NotConfiguredStayLookup);
    expect(await lookup.findInHouseByRoom('p', '101')).toEqual({ kind: 'not_configured' });
    expect(await lookup.getStay('p', 'r')).toEqual({ kind: 'not_configured' });
  });

  it('returns the fake with demo stays for HAIP_STAY_LOOKUP=fake', () => {
    expect(createStayLookup({ HAIP_STAY_LOOKUP: 'fake' }, quietLogger())).toBeInstanceOf(FakeStayLookup);
  });

  it('throws for fake in production, so the API refuses to start', () => {
    expect(() => createStayLookup({ HAIP_STAY_LOOKUP: 'fake', NODE_ENV: 'production' }, quietLogger())).toThrow(
      /not allowed when NODE_ENV=production/,
    );
  });
});
