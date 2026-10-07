import { describe, it, expect } from 'vitest';
import { cartItemCount, cartReducer, cartSubtotal, emptyCart, unavailableLines, type CartAction, type CartState } from './cart.js';
import type { MenuItem } from './types.js';

function menuItem(id: string, price: string, overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id,
    propertyId: 'p',
    category: null,
    name: id,
    description: null,
    price,
    currencyCode: 'USD',
    isAvailable: true,
    sortOrder: 0,
    createdAt: '2026-10-07T10:00:00.000Z',
    updatedAt: '2026-10-07T10:00:00.000Z',
    ...overrides,
  };
}

const sandwich = menuItem('sandwich', '12.50');
const soda = menuItem('soda', '3.25');

function run(...actions: CartAction[]): CartState {
  return actions.reduce(cartReducer, emptyCart);
}

describe('cartReducer', () => {
  it('adding the same item twice increments one line', () => {
    const state = run({ type: 'add', item: sandwich }, { type: 'add', item: sandwich });
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]!.quantity).toBe(2);
  });

  it('clamps quantity between 1 and 50', () => {
    const base = run({ type: 'add', item: soda });
    expect(cartReducer(base, { type: 'setQuantity', menuItemId: 'soda', quantity: 0 }).lines[0]!.quantity).toBe(1);
    expect(cartReducer(base, { type: 'setQuantity', menuItemId: 'soda', quantity: 99 }).lines[0]!.quantity).toBe(50);
    expect(cartReducer(base, { type: 'setQuantity', menuItemId: 'soda', quantity: Number.NaN }).lines[0]!.quantity).toBe(1);
    expect(cartReducer(base, { type: 'setQuantity', menuItemId: 'soda', quantity: 7.9 }).lines[0]!.quantity).toBe(7);
  });

  it('adding beyond 50 stays at 50', () => {
    const at50 = cartReducer(run({ type: 'add', item: soda }), { type: 'setQuantity', menuItemId: 'soda', quantity: 50 });
    expect(cartReducer(at50, { type: 'add', item: soda }).lines[0]!.quantity).toBe(50);
  });

  it('sets a per-item note, removes a line, and clears', () => {
    let state = run({ type: 'add', item: sandwich }, { type: 'add', item: soda });
    state = cartReducer(state, { type: 'setNote', menuItemId: 'sandwich', note: 'No onions' });
    expect(state.lines[0]!.note).toBe('No onions');
    state = cartReducer(state, { type: 'remove', menuItemId: 'sandwich' });
    expect(state.lines.map((l) => l.menuItemId)).toEqual(['soda']);
    expect(cartReducer(state, { type: 'clear' })).toEqual(emptyCart);
  });

  it('syncMenu refreshes prices and drops unavailable or deleted items', () => {
    const state = run({ type: 'add', item: sandwich }, { type: 'add', item: soda });
    const menu = [menuItem('sandwich', '14.00'), menuItem('soda', '3.25', { isAvailable: false })];

    expect(unavailableLines(state, menu).map((l) => l.menuItemId)).toEqual(['soda']);
    const synced = cartReducer(state, { type: 'syncMenu', menu });
    expect(synced.lines).toHaveLength(1);
    expect(synced.lines[0]).toMatchObject({ menuItemId: 'sandwich', unitPrice: '14.00', quantity: 1 });
  });
});

describe('cartSubtotal', () => {
  it('computes exact integer minor units (12.50 × 2 + 3.25 × 3 = 34.75)', () => {
    const state = run(
      { type: 'add', item: sandwich },
      { type: 'add', item: sandwich },
      { type: 'add', item: soda },
      { type: 'setQuantity', menuItemId: 'soda', quantity: 3 },
    );
    expect(cartSubtotal(state)).toEqual({ kind: 'ok', minor: 3475, currencyCode: 'USD' });
    expect(cartItemCount(state)).toBe(5);
  });

  it('avoids float drift (0.10 × 3 = 30 minor units)', () => {
    const state = run({ type: 'add', item: menuItem('dime', '0.10') }, { type: 'setQuantity', menuItemId: 'dime', quantity: 3 });
    expect(cartSubtotal(state)).toEqual({ kind: 'ok', minor: 30, currencyCode: 'USD' });
  });

  it('reports empty and mixed-currency carts', () => {
    expect(cartSubtotal(emptyCart)).toEqual({ kind: 'empty' });
    const mixed = run({ type: 'add', item: sandwich }, { type: 'add', item: menuItem('cake', '5.00', { currencyCode: 'EUR' }) });
    expect(cartSubtotal(mixed)).toEqual({ kind: 'mixed' });
  });
});
