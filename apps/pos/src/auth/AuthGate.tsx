import { useEffect, useState, type ReactNode } from 'react';
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { Button } from '@stayx/ui';
import { AccountScreen, SigningIn } from '../components/AccountScreens.js';
import { runBeforeSignIn, setAuthHooks } from './auth-hooks.js';
import { clearCartStash } from './cart-stash.js';
import { safeReturnPath, sessionFromAccessToken, type AuthSettings, type Session } from './session.js';

export interface SignedIn {
  session: Session;
  signOut: () => void;
}

type GateState = { kind: 'loading' } | { kind: 'signed-in'; session: Session } | { kind: 'error'; message: string };
type OidcSettings = Extract<AuthSettings, { enabled: true }>;

// One manager and one start per page load: React StrictMode runs effects twice in
// development, and the redirect callback can only be completed once.
let manager: UserManager | null = null;
let starting: Promise<User | null> | null = null;
let redirecting = false;

function managerFor(settings: OidcSettings): UserManager {
  manager ??= new UserManager({
    authority: settings.authority,
    client_id: settings.clientId,
    redirect_uri: `${window.location.origin}/`,
    post_logout_redirect_uri: `${window.location.origin}/`,
    response_type: 'code', // authorization code + PKCE; a public client, no secret
    scope: 'openid',
    // Renews shortly before expiry (with the refresh token Keycloak issues).
    automaticSilentRenew: true,
    // This tab only; closing it signs the POS out on this device.
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
  return manager;
}

/** Finishes a sign-in redirect if we are on one, else returns the stored user if still usable. */
function start(m: UserManager): Promise<User | null> {
  starting ??= (async () => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('error') && params.has('state')) {
      throw new Error(params.get('error_description') ?? params.get('error') ?? 'sign-in failed');
    }
    if (params.has('code') && params.has('state')) {
      const user = await m.signinRedirectCallback();
      // Back to where the user was, without the code in the address bar.
      window.history.replaceState(null, '', safeReturnPath((user.state as { returnTo?: unknown } | undefined)?.returnTo));
      return user;
    }
    const user = await m.getUser();
    if (user && !user.expired) return user;
    if (user?.refresh_token) return m.signinSilent().catch(() => null);
    return null;
  })();
  return starting;
}

/** Leave for the sign-in page, keeping the cart. Only once, however many calls fail at the same time. */
function signIn(m: UserManager, onError: (message: string) => void) {
  if (redirecting) return;
  redirecting = true;
  runBeforeSignIn();
  const { pathname, search, hash } = window.location;
  m.signinRedirect({ state: { returnTo: pathname + search + hash } }).catch((error: unknown) => {
    redirecting = false;
    onError(error instanceof Error ? error.message : 'could not reach the sign-in page');
  });
}

/**
 * Signs the user in (INTEGRATION_DESIGN.md §8.6) and renders the POS for them. While
 * mounted, API calls and the socket carry the user's access token.
 */
export function AuthGate({ settings, children }: { settings: OidcSettings; children: (signedIn: SignedIn) => ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'loading' });

  useEffect(() => {
    const m = managerFor(settings);
    let alive = true;
    const fail = (message: string) => {
      if (alive) setState({ kind: 'error', message });
    };
    const loaded = (user: User) => {
      if (alive) setState({ kind: 'signed-in', session: sessionFromAccessToken(user.access_token) });
    };
    const ended = () => signIn(m, fail);

    setAuthHooks({
      getToken: async () => {
        const user = await m.getUser();
        return user && !user.expired ? user.access_token : null;
      },
      sessionEnded: ended,
    });
    m.events.addUserLoaded(loaded); // also after each silent renewal: roles may have changed
    m.events.addAccessTokenExpired(ended); // renewal failed (e.g. the Keycloak session ended)

    start(m).then(
      (user) => (user ? loaded(user) : ended()),
      (error: unknown) => fail(error instanceof Error ? error.message : 'sign-in failed'),
    );

    return () => {
      alive = false;
      m.events.removeUserLoaded(loaded);
      m.events.removeAccessTokenExpired(ended);
      setAuthHooks(null);
    };
  }, [settings]);

  if (state.kind === 'loading') return <SigningIn />;
  if (state.kind === 'error') {
    return (
      <AccountScreen title="Could not sign in">
        <p className="text-sm text-telivity-slate">{state.message}</p>
        <Button onClick={() => window.location.assign('/')} className="min-h-11 self-start">
          Try again
        </Button>
      </AccountScreen>
    );
  }

  const signOut = () => {
    clearCartStash(window.sessionStorage);
    void managerFor(settings).signoutRedirect();
  };
  return <>{children({ session: state.session, signOut })}</>;
}
