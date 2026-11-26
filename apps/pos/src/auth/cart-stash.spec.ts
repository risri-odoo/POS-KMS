import { describe, expect, it } from 'vitest';
import { CART_STASH_KEY, CART_STASH_MAX_AGE_MS, clearCartStash, peekCartStash, saveCartStash, type CartStash } from './cart-stash.js';

const A = 'a0000001-0000-4000-a000-00000000000a';
const B = 'b0000002-0000-4000-a000-00000000000b';
const NOW = 1_800_000_000_000;

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const stash: CartStash = {
  propertyId: A,
  cart: { lines: [{ menuItemId: 'm1', name: 'Tea', unitPrice: '5.00', currencyCode: 'USD', quantity: 2, note: 'no sugar' }] },
  roomNumber: '101',
  orderNotes: 'knock softly',
  savedAt: NOW,
};

describe('cart stash', () => {
  it('keeps the order in progress for the same hotel and gives it back', () => {
    const storage = memoryStorage();
    saveCartStash(storage, stash);
    expect(peekCartStash(storage, A, NOW + 60_000)).toEqual(stash);
    // Peeking doesn't remove it (StrictMode runs initialisers twice); clearing does.
    expect(peekCartStash(storage, A, NOW + 60_000)).not.toBeNull();
    clearCartStash(storage);
    expect(peekCartStash(storage, A, NOW + 60_000)).toBeNull();
  });

  it('never restores into another hotel', () => {
    const storage = memoryStorage();
    saveCartStash(storage, stash);
    expect(peekCartStash(storage, B, NOW)).toBeNull();
  });

  it('drops a stash older than 30 minutes, or from the future', () => {
    const storage = memoryStorage();
    saveCartStash(storage, stash);
    expect(peekCartStash(storage, A, NOW + CART_STASH_MAX_AGE_MS + 1)).toBeNull();
    expect(peekCartStash(storage, A, NOW - 1)).toBeNull();
  });

  it('saves nothing when there is nothing to keep', () => {
    const storage = memoryStorage();
    saveCartStash(storage, { ...stash, cart: { lines: [] }, roomNumber: '', orderNotes: '' });
    expect(storage.data.size).toBe(0);
  });

  it('ignores a malformed stash instead of breaking the screen', () => {
    const storage = memoryStorage();
    for (const raw of ['not json', 'null', JSON.stringify({ ...stash, cart: { lines: [{ menuItemId: 1 }] } }), JSON.stringify({ ...stash, savedAt: 'x' })]) {
      storage.setItem(CART_STASH_KEY, raw);
      expect(peekCartStash(storage, A, NOW)).toBeNull();
    }
  });

  it('survives storage that refuses to write', () => {
    const full = { ...memoryStorage(), setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(() => saveCartStash(full, stash)).not.toThrow();
  });
});
