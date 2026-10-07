import { describe, it, expect } from 'vitest';
import { getAllowedOrigins } from './cors.js';

describe('getAllowedOrigins', () => {
  it('defaults to the kitchen (5173) and POS (5174) dev servers', () => {
    expect(getAllowedOrigins({})).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5174',
    ]);
  });

  it('uses CORS_ORIGINS when set, trimming blanks', () => {
    expect(getAllowedOrigins({ CORS_ORIGINS: ' https://a.example , ,https://b.example ' })).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('falls back to the defaults when CORS_ORIGINS is empty', () => {
    expect(getAllowedOrigins({ CORS_ORIGINS: '   ' })).toHaveLength(4);
  });
});
