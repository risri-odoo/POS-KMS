/**
 * POS only: what to do just before the page leaves for sign-in. The POS screen registers
 * how to keep the order being built (cart-stash.ts); the shared sign-in core calls it.
 */
let beforeSignIn: (() => void) | null = null;

export function setBeforeSignIn(callback: (() => void) | null): void {
  beforeSignIn = callback;
}

export function runBeforeSignIn(): void {
  try {
    beforeSignIn?.();
  } catch {
    // Never block the sign-in because the cart couldn't be kept.
  }
}
