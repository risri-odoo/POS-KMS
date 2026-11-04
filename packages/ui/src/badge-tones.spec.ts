import { describe, expect, it } from 'vitest';
import { ORDER_STATUS_TONE, toneClass } from './badge-tones.js';

describe('order status colours', () => {
  it('follows the agreed mapping', () => {
    expect(ORDER_STATUS_TONE).toEqual({
      placed: 'orange',
      accepted: 'deep-blue',
      preparing: 'teal',
      ready: 'yellow',
      delivered: 'dark-teal',
      cancelled: 'grey',
    });
  });
});

describe('toneClass', () => {
  it('matches HAIP by default: white text on teal and orange', () => {
    expect(toneClass('teal')).toContain('text-white');
    expect(toneClass('orange')).toContain('text-white');
  });

  it('uses navy text on teal, orange and yellow for kitchen screens', () => {
    for (const tone of ['teal', 'orange', 'yellow'] as const) {
      expect(toneClass(tone, true)).toContain('text-telivity-navy');
    }
  });

  it('keeps navy text on yellow in both modes', () => {
    expect(toneClass('yellow')).toContain('text-telivity-navy');
  });

  it('leaves other tones unchanged in high contrast', () => {
    expect(toneClass('deep-blue', true)).toBe(toneClass('deep-blue'));
  });
});
