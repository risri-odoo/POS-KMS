/**
 * How API calls and the socket get the current access token, and how they report that
 * the session has ended. Set by AuthGate when login is on; null when it is off, and
 * then requests go without a token, as before.
 */
export interface AuthHooks {
  /** The current access token, or null if there is none (the API will then answer 401). */
  getToken(): Promise<string | null>;
  /** The API or socket refused the token: keep the cart and go back to sign-in. */
  sessionEnded(): void;
}

let current: AuthHooks | null = null;

export function setAuthHooks(hooks: AuthHooks | null): void {
  current = hooks;
}

export function authHooks(): AuthHooks | null {
  return current;
}

let beforeSignIn: (() => void) | null = null;

/** The POS screen registers how to keep the cart before the page leaves for sign-in. */
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

/** Socket.IO calls this on every (re)connect, so a reconnect always sends the latest token. */
export function socketAuth(callback: (auth: Record<string, unknown>) => void): void {
  const hooks = current;
  if (!hooks) return callback({});
  hooks.getToken().then(
    (token) => callback(token ? { token } : {}),
    () => callback({}),
  );
}
