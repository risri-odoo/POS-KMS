import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@nestjs/common';
import { FakeStayLookup } from './fake-stay-lookup.js';
import { createStayLookup, loadStayLookupMode } from './stay-lookup.config.js';
import { NotConfiguredStayLookup } from './stay-lookup.js';

const quietLogger = () => ({ warn: vi.fn() }) as unknown as Logger;

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
    expect(() => loadStayLookupMode({ HAIP_STAY_LOOKUP: 'haip' })).toThrow('HAIP_STAY_LOOKUP="haip" is not supported');
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
