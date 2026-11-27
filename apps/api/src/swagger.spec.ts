import { describe, expect, it } from 'vitest';
import { swaggerEnabled } from './swagger.js';

describe('swaggerEnabled', () => {
  it('serves /docs in development and tests', () => {
    expect(swaggerEnabled({})).toBe(true);
    expect(swaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(swaggerEnabled({ NODE_ENV: 'test' })).toBe(true);
  });

  it('never in production', () => {
    expect(swaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(swaggerEnabled({ NODE_ENV: ' production ' })).toBe(false);
  });
});
