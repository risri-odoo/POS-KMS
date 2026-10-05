import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { generateOrderNumber, priceOrder, type PricedMenuItem } from './order-pricing.js';

const SANDWICH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SODA = 'aaaaaaaa-0000-4000-8000-000000000002';
const SOUP = 'aaaaaaaa-0000-4000-8000-000000000003';
const EURO_CAKE = 'aaaaaaaa-0000-4000-8000-000000000004';

function menu(...items: PricedMenuItem[]): Map<string, PricedMenuItem> {
  return new Map(items.map((i) => [i.id, i]));
}

const sandwich: PricedMenuItem = { id: SANDWICH, name: 'Club Sandwich', price: '12.50', currencyCode: 'USD', isAvailable: true };
const soda: PricedMenuItem = { id: SODA, name: 'Soda', price: '3.25', currencyCode: 'USD', isAvailable: true };
const soup: PricedMenuItem = { id: SOUP, name: 'Soup', price: '7.00', currencyCode: 'USD', isAvailable: false };
const cake: PricedMenuItem = { id: EURO_CAKE, name: 'Cake', price: '5.00', currencyCode: 'EUR', isAvailable: true };

describe('priceOrder', () => {
  it('computes exact decimal totals (12.50 x 2 + 3.25 x 3 = 34.75)', () => {
    const result = priceOrder(menu(sandwich, soda), [
      { menuItemId: SANDWICH, quantity: 2, notes: 'No onions' },
      { menuItemId: SODA, quantity: 3 },
    ]);

    expect(result.subtotal).toBe('34.75');
    expect(result.currencyCode).toBe('USD');
    expect(result.lines).toEqual([
      { menuItemId: SANDWICH, name: 'Club Sandwich', unitPrice: '12.50', quantity: 2, lineTotal: '25.00', notes: 'No onions' },
      { menuItemId: SODA, name: 'Soda', unitPrice: '3.25', quantity: 3, lineTotal: '9.75', notes: null },
    ]);
  });

  it('avoids float drift (0.10 x 3 + 0.20 = 0.50, not 0.5000000001)', () => {
    const tenCents: PricedMenuItem = { ...soda, price: '0.10' };
    const twentyCents: PricedMenuItem = { ...sandwich, price: '0.20' };
    const result = priceOrder(menu(tenCents, twentyCents), [
      { menuItemId: SODA, quantity: 3 },
      { menuItemId: SANDWICH, quantity: 1 },
    ]);
    expect(result.subtotal).toBe('0.50');
  });

  it('allows the same menu item on separate lines (e.g. different notes)', () => {
    const result = priceOrder(menu(soda), [
      { menuItemId: SODA, quantity: 1, notes: 'Ice' },
      { menuItemId: SODA, quantity: 1, notes: 'No ice' },
    ]);
    expect(result.lines).toHaveLength(2);
    expect(result.subtotal).toBe('6.50');
  });

  it('rejects unknown menu items', () => {
    expect(() => priceOrder(menu(sandwich), [{ menuItemId: SODA, quantity: 1 }])).toThrow(BadRequestException);
  });

  it('rejects unavailable menu items', () => {
    expect(() => priceOrder(menu(sandwich, soup), [
      { menuItemId: SANDWICH, quantity: 1 },
      { menuItemId: SOUP, quantity: 1 },
    ])).toThrow(/not available/);
  });

  it('rejects mixed currencies', () => {
    expect(() => priceOrder(menu(sandwich, cake), [
      { menuItemId: SANDWICH, quantity: 1 },
      { menuItemId: EURO_CAKE, quantity: 1 },
    ])).toThrow(BadRequestException);
  });

  it('rejects an empty order', () => {
    expect(() => priceOrder(menu(sandwich), [])).toThrow(BadRequestException);
  });
});

describe('generateOrderNumber', () => {
  it('formats as RS-YYMMDD-XXXX using the UTC date', () => {
    const n = generateOrderNumber(new Date('2026-10-05T23:30:00Z'));
    expect(n).toMatch(/^RS-261005-[0-9A-HJ-NP-Z]{4}$/);
  });

  it('produces varying suffixes', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    const seen = new Set(Array.from({ length: 50 }, () => generateOrderNumber(now)));
    expect(seen.size).toBeGreaterThan(40);
  });
});
