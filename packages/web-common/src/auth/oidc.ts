import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { safeReturnPath, type OidcSettings } from './session.js';

/**
 * The sign-in core both screens share: one UserManager and one start per page load
 * (React StrictMode runs effects twice in development, and the redirect callback can
 * only be completed once), authorization code + PKCE as a public client.
 */
export interface OidcClient {
  manager: UserManager;
  /** Finishes a sign-in redirect if we are on one, else the stored user if still usable. */
  start(): Promise<User | null>;
  /** Leaves for the sign-in page (once, however many callers), coming back to this page. */
  signIn(onError: (message: string) => void, beforeLeave?: () => void): void;
  /** The current access token, or null when there is none or it has expired. */
  accessToken(): Promise<string | null>;
}

let client: OidcClient | null = null;

/**
 * @param store where tokens are kept: sessionStorage on the POS (shared terminals change
 *   hands), localStorage on kitchen tablets (stay signed in across a restart; §8.6).
 */
export function oidcClient(settings: OidcSettings, store: Storage): OidcClient {
  if (client) return client;
  const manager = new UserManager({
    authority: settings.authority,
    client_id: settings.clientId,
    redirect_uri: `${window.location.origin}/`,
    post_logout_redirect_uri: `${window.location.origin}/`,
    response_type: 'code', // authorization code + PKCE; a public client, no secret
    scope: 'openid',
    automaticSilentRenew: true, // shortly before expiry, with the refresh token
    userStore: new WebStorageStateStore({ store }),
  });
  let starting: Promise<User | null> | null = null;
  let redirecting = false;

  client = {
    manager,
    start() {
      starting ??= (async () => {
        const params = new URLSearchParams(window.location.search);
        if (params.has('error') && params.has('state')) {
          throw new Error(params.get('error_description') ?? params.get('error') ?? 'sign-in failed');
        }
        if (params.has('code') && params.has('state')) {
          const user = await manager.signinRedirectCallback();
          // Back to where the user was, without the code in the address bar.
          window.history.replaceState(null, '', safeReturnPath((user.state as { returnTo?: unknown } | undefined)?.returnTo));
          return user;
        }
        const user = await manager.getUser();
        if (user && !user.expired) return user;
        if (user?.refresh_token) return manager.signinSilent().catch(() => null);
        return null;
      })();
      return starting;
    },
    signIn(onError, beforeLeave) {
      if (redirecting) return;
      redirecting = true;
      try {
        beforeLeave?.();
      } catch {
        // never block the sign-in
      }
      const { pathname, search, hash } = window.location;
      manager.signinRedirect({ state: { returnTo: pathname + search + hash } }).catch((error: unknown) => {
        redirecting = false;
        onError(error instanceof Error ? error.message : 'could not reach the sign-in page');
      });
    },
    async accessToken() {
      const user = await manager.getUser();
      return user && !user.expired ? user.access_token : null;
    },
  };
  return client;
}
