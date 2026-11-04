import { describe, it, expect } from 'vitest';
import { getAllowedOrigins } from './cors.js';

describe('getAllowedOrigins', () => {
  it('defaults to the kitchen (5181) and POS (5180) dev servers', () => {
    expect(getAllowedOrigins({})).toEqual([
      'http://localhost:5181',
      'http://127.0.0.1:5181',
      'http://localhost:5180',
      'http://127.0.0.1:5180',
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
