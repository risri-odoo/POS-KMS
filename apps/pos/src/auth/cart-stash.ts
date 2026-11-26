import type { CartLine, CartState } from '../cart.js';

/**
 * Keeps the order being built across a sign-in redirect (§8.6: "keeping the cart if
 * possible"). sessionStorage only: this tab, gone when it closes. The guest choice is
 * NOT kept: after signing in again staff look the room up and confirm the guest anew.
 */
export const CART_STASH_KEY = 'stayx-pos:cart-before-sign-in';
/** An older stash is dropped: the menu or the guest may have changed. */
export const CART_STASH_MAX_AGE_MS = 30 * 60 * 1000;

export interface CartStash {
  propertyId: string;
  cart: CartState;
  roomNumber: string;
  orderNotes: string;
  savedAt: number;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function saveCartStash(storage: Storage, stash: CartStash): void {
  if (stash.cart.lines.length === 0 && !stash.roomNumber && !stash.orderNotes) return;
  try {
    storage.setItem(CART_STASH_KEY, JSON.stringify(stash));
  } catch {
    // Storage full or blocked: the cart is lost, as it would be without this.
  }
}

const isLine = (l: unknown): l is CartLine => {
  const line = l as Partial<CartLine> | null;
  return (
    typeof line === 'object' &&
    line !== null &&
    typeof line.menuItemId === 'string' &&
    typeof line.name === 'string' &&
    typeof line.unitPrice === 'string' &&
    typeof line.currencyCode === 'string' &&
    typeof line.quantity === 'number' &&
    typeof line.note === 'string'
  );
};

/** The stash for this hotel if it is recent and well formed. Does not remove it (see clearCartStash). */
export function peekCartStash(storage: Storage, propertyId: string, now: number): CartStash | null {
  let parsed: Partial<CartStash>;
  try {
    parsed = JSON.parse(storage.getItem(CART_STASH_KEY) ?? 'null') as Partial<CartStash>;
  } catch {
    return null;
  }
  if (!parsed || parsed.propertyId !== propertyId) return null;
  if (typeof parsed.savedAt !== 'number' || now - parsed.savedAt > CART_STASH_MAX_AGE_MS || parsed.savedAt > now) return null;
  const lines = parsed.cart?.lines;
  if (!Array.isArray(lines) || !lines.every(isLine)) return null;
  return {
    propertyId,
    cart: { lines },
    roomNumber: typeof parsed.roomNumber === 'string' ? parsed.roomNumber : '',
    orderNotes: typeof parsed.orderNotes === 'string' ? parsed.orderNotes : '',
    savedAt: parsed.savedAt,
  };
}

export function clearCartStash(storage: Storage): void {
  try {
    storage.removeItem(CART_STASH_KEY);
  } catch {
    // ignore
  }
}
