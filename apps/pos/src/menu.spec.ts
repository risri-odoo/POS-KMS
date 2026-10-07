import { describe, it, expect } from 'vitest';
import { formatAge, groupAvailableMenu, sortMenu } from './menu.js';
import { propertyIdFromSearch } from './config.js';
import type { MenuItem } from './types.js';

function item(id: string, category: string | null, overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id,
    propertyId: 'p',
    category,
    name: id,
    description: null,
    price: '1.00',
    currencyCode: 'USD',
    isAvailable: true,
    sortOrder: 0,
    createdAt: '2026-10-07T10:00:00.000Z',
    updatedAt: '2026-10-07T10:00:00.000Z',
    ...overrides,
  };
}

describe('groupAvailableMenu', () => {
  it('groups by category, hides unavailable items, puts uncategorised under Other last', () => {
    const groups = groupAvailableMenu([
      item('soda', 'Drinks'),
      item('mystery', null),
      item('blank', '  '),
      item('burger', 'Mains', { sortOrder: 2 }),
      item('salad', 'Mains', { sortOrder: 1 }),
      item('soup', 'Mains', { isAvailable: false }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(['Drinks', 'Mains', 'Other']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['salad', 'burger']);
    expect(groups[2]!.items.map((i) => i.id).sort()).toEqual(['blank', 'mystery']);
  });

  it('sortMenu matches the API order (category, sortOrder, name)', () => {
    expect(sortMenu([item('b', 'X'), item('a', 'X'), item('z', 'A')]).map((i) => i.id)).toEqual(['z', 'a', 'b']);
  });
});

describe('formatAge', () => {
  const base = Date.parse('2026-10-07T10:00:00.000Z');
  it('formats short and long ages', () => {
    expect(formatAge('2026-10-07T10:00:00.000Z', base + 20_000)).toBe('just now');
    expect(formatAge('2026-10-07T10:00:00.000Z', base + 7 * 60_000)).toBe('7 min');
    expect(formatAge('2026-10-07T10:00:00.000Z', base + 125 * 60_000)).toBe('2 h 5 min');
    expect(formatAge('2026-10-07T10:00:00.000Z', base - 60_000)).toBe('just now');
    expect(formatAge('nope', base)).toBe('');
  });
});

describe('propertyIdFromSearch', () => {
  it('accepts a UUID and rejects anything else', () => {
    expect(propertyIdFromSearch('?propertyId=11111111-1111-4111-8111-111111111111')).toBe('11111111-1111-4111-8111-111111111111');
    expect(propertyIdFromSearch('?propertyId=abc')).toBeNull();
  });
});
