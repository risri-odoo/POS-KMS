import { describe, expect, it, vi } from 'vitest';
import {
  CART_STASH_KEY,
  CART_STASH_MAX_AGE_MS,
  clearCartStash,
  peekCartStash,
  saveCartStash,
  signOutClearingCart,
  type CartStash,
} from './cart-stash.js';

const A = 'a0000001-0000-4000-a000-00000000000a';
const B = 'b0000002-0000-4000-a000-00000000000b';
const ALICE = 'sub-alice';
const BOB = 'sub-bob';
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
  userSub: ALICE,
  cart: { lines: [{ menuItemId: 'm1', name: 'Tea', unitPrice: '5.00', currencyCode: 'USD', quantity: 2, note: 'no sugar' }] },
  roomNumber: '101',
  orderNotes: 'knock softly',
  savedAt: NOW,
};

describe('cart stash', () => {
  it('gives the order in progress back to the same user, same hotel', () => {
    const storage = memoryStorage();
    saveCartStash(storage, stash);
    expect(peekCartStash(storage, A, ALICE, NOW + 60_000)).toEqual(stash);
    // Peeking doesn't remove it (StrictMode runs initialisers twice); clearing does.
    expect(peekCartStash(storage, A, ALICE, NOW + 60_000)).not.toBeNull();
    clearCartStash(storage);
    expect(peekCartStash(storage, A, ALICE, NOW + 60_000)).toBeNull();
  });

  it('never gives it to a different user on the same terminal', () => {
    const storage = memoryStorage();
    saveCartStash(storage, stash);
    expect(peekCartStash(storage, A, BOB, NOW)).toBeNull();
    expect(peekCartStash(storage, A, '', NOW)).toBeNull();
  });

  it('does not restore a stash with no owner (e.g. saved before this check existed)', () => {
    const storage = memoryStorage();
    const { userSub: _ignored, ...ownerless } = stash;
    storage.setItem(CART_STASH_KEY, JSON.stringify(ownerless));
    expect(peekCartStash(storage, A, ALICE, NOW)).toBeNull();
    saveCartStash(storage, { ...stash, userSub: '' });
    expect(storage.data.get(CART_STASH_KEY)).toBe(JSON.stringify(ownerless)); // not overwritten by an ownerless save
  });

  it('never restores into another hotel', () => {
    const storage = memoryStorage();
    saveCartStash(storage, stash);
    expect(peekCartStash(storage, B, ALICE, NOW)).toBeNull();
  });

  it('drops a stash older than 30 minutes, or from the future', () => {
    const storage = memoryStorage();
    saveCartStash(storage, stash);
    expect(peekCartStash(storage, A, ALICE, NOW + CART_STASH_MAX_AGE_MS + 1)).toBeNull();
    expect(peekCartStash(storage, A, ALICE, NOW - 1)).toBeNull();
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
      expect(peekCartStash(storage, A, ALICE, NOW)).toBeNull();
    }
  });

  it('survives storage that refuses to write', () => {
    const full = { ...memoryStorage(), setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(() => saveCartStash(full, stash)).not.toThrow();
  });
});

describe('Sign out', () => {
  it('clears the kept order, then goes to the provider’s logout', async () => {
    const storage = memoryStorage();
    saveCartStash(storage, stash);
    const order: string[] = [];
    const logout = vi.fn(() => {
      order.push(storage.data.has(CART_STASH_KEY) ? 'logout with cart still kept' : 'logout after clearing');
      return Promise.resolve();
    });
    await signOutClearingCart(storage, logout);
    expect(order).toEqual(['logout after clearing']);
    expect(peekCartStash(storage, A, ALICE, NOW)).toBeNull();
  });

  it('clears it even when the logout redirect fails', async () => {
    const storage = memoryStorage();
    saveCartStash(storage, stash);
    await expect(signOutClearingCart(storage, () => Promise.reject(new Error('provider down')))).rejects.toThrow('provider down');
    expect(storage.data.size).toBe(0);
  });

  it('still logs out when storage is unavailable', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    await signOutClearingCart(null, logout);
    expect(logout).toHaveBeenCalledOnce();
  });
});
