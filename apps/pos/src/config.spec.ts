import { describe, it, expect } from 'vitest';
import { resolvePropertyId } from './config.js';

const DEMO = 'a0000001-0000-4000-a000-000000000001';
const OTHER = '11111111-1111-4111-8111-111111111111';

describe('resolvePropertyId', () => {
  it('uses ?propertyId= when present and valid, ignoring the default', () => {
    expect(resolvePropertyId(`?propertyId=${OTHER}`, DEMO)).toBe(OTHER);
  });

  it('shows the form (null) for an invalid ?propertyId=, even with a default', () => {
    expect(resolvePropertyId('?propertyId=nope', DEMO)).toBeNull();
    expect(resolvePropertyId('?propertyId=', DEMO)).toBeNull();
  });

  it('falls back to the default when the param is absent', () => {
    expect(resolvePropertyId('', DEMO)).toBe(DEMO);
    expect(resolvePropertyId('?other=1', ` ${DEMO} `)).toBe(DEMO);
  });

  it('returns null when absent and the default is missing or invalid', () => {
    expect(resolvePropertyId('', undefined)).toBeNull();
    expect(resolvePropertyId('', 'not-a-uuid')).toBeNull();
  });
});
