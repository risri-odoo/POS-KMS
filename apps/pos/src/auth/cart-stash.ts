import type { CartLine, CartState } from '../cart.js';

/**
 * Keeps the order being built across a sign-in redirect (§8.6: "keeping the cart if
 * possible"). sessionStorage only: this tab, gone when it closes. The guest choice is
 * NOT kept: after signing in again staff look the room up and confirm the guest anew.
 * Only the same user gets it back: on a shared terminal the next person to sign in must
 * not inherit someone else's order (placedBy would be theirs). Sign out clears it.
 */
export const CART_STASH_KEY = 'stayx-pos:cart-before-sign-in';
/** An older stash is dropped: the menu or the guest may have changed. */
export const CART_STASH_MAX_AGE_MS = 30 * 60 * 1000;

export interface CartStash {
  propertyId: string;
  /** The token's sub of the user who built the order. */
  userSub: string;
  cart: CartState;
  roomNumber: string;
  orderNotes: string;
  savedAt: number;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function saveCartStash(storage: Storage, stash: CartStash): void {
  if (!stash.userSub) return; // no way to tell whose it is
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

/**
 * The stash if it was built by this user, for this hotel, recently, and is well formed.
 * Does not remove it (see clearCartStash).
 */
export function peekCartStash(storage: Storage, propertyId: string, userSub: string, now: number): CartStash | null {
  let parsed: Partial<CartStash>;
  try {
    parsed = JSON.parse(storage.getItem(CART_STASH_KEY) ?? 'null') as Partial<CartStash>;
  } catch {
    return null;
  }
  if (!parsed || parsed.propertyId !== propertyId) return null;
  if (!userSub || parsed.userSub !== userSub) return null;
  if (typeof parsed.savedAt !== 'number' || now - parsed.savedAt > CART_STASH_MAX_AGE_MS || parsed.savedAt > now) return null;
  const lines = parsed.cart?.lines;
  if (!Array.isArray(lines) || !lines.every(isLine)) return null;
  return {
    propertyId,
    userSub,
    cart: { lines },
    roomNumber: typeof parsed.roomNumber === 'string' ? parsed.roomNumber : '',
    orderNotes: typeof parsed.orderNotes === 'string' ? parsed.orderNotes : '',
    savedAt: parsed.savedAt,
  };
}

/**
 * Explicit Sign out: forget the kept order first, then leave for the provider's logout.
 * The order is cleared even if the logout redirect fails.
 */
export async function signOutClearingCart(storage: Storage | null, logout: () => Promise<void>): Promise<void> {
  if (storage) clearCartStash(storage);
  await logout();
}

export function clearCartStash(storage: Storage): void {
  try {
    storage.removeItem(CART_STASH_KEY);
  } catch {
    // ignore
  }
}
