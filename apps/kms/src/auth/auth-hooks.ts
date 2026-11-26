/**
 * How API calls and the socket get the current access token, and how they report that
 * the session has ended. Set by AuthGate when login is on; null when it is off, and
 * then requests go without a token, as before.
 * TODO(step H): shared with apps/pos/src/auth/auth-hooks.ts in all but sessionEnded's effect.
 */
export interface AuthHooks {
  /** The current access token, or null if there is none (the API will then answer 401). */
  getToken(): Promise<string | null>;
  /**
   * The API or socket refused the token. The board shows "Sign in again" and keeps
   * displaying what it has; it does not leave the page by itself (§8.6).
   */
  sessionEnded(): void;
}

let current: AuthHooks | null = null;

export function setAuthHooks(hooks: AuthHooks | null): void {
  current = hooks;
}

export function authHooks(): AuthHooks | null {
  return current;
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
