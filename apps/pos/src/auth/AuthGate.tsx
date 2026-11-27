import { useEffect, useState, type ReactNode } from 'react';
import type { User } from 'oidc-client-ts';
import { Button } from '@stayx/ui';
import { oidcClient, sessionFromAccessToken, setAuthHooks, type OidcSettings, type Session } from '@stayx/web-common/auth';
import { AccountScreen, SigningIn } from '../components/AccountScreens.js';
import { runBeforeSignIn } from './before-sign-in.js';
import { signOutClearingCart } from './cart-stash.js';

export interface SignedIn {
  session: Session;
  signOut: () => void;
}

type GateState = { kind: 'loading' } | { kind: 'signed-in'; session: Session } | { kind: 'error'; message: string };

/** This tab only: shared terminals change hands, so closing the tab signs the POS out (§8.6). */
const client = (settings: OidcSettings) => oidcClient(settings, window.sessionStorage);

/**
 * Signs the user in (INTEGRATION_DESIGN.md §8.6) and renders the POS for them. While
 * mounted, API calls and the socket carry the user's access token. When the session
 * ends, the order being built is kept and the page goes back to sign-in.
 */
export function AuthGate({ settings, children }: { settings: OidcSettings; children: (signedIn: SignedIn) => ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'loading' });

  useEffect(() => {
    const oidc = client(settings);
    const m = oidc.manager;
    let alive = true;
    const fail = (message: string) => {
      if (alive) setState({ kind: 'error', message });
    };
    const loaded = (user: User) => {
      if (alive) setState({ kind: 'signed-in', session: sessionFromAccessToken(user.access_token) });
    };
    const ended = () => oidc.signIn(fail, runBeforeSignIn);

    setAuthHooks({ getToken: () => oidc.accessToken(), sessionEnded: ended });
    m.events.addUserLoaded(loaded); // also after each silent renewal: roles may have changed
    m.events.addAccessTokenExpired(ended); // renewal failed (e.g. the Keycloak session ended)

    oidc.start().then(
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
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      // blocked storage: nothing was kept there
    }
    void signOutClearingCart(storage, () => client(settings).manager.signoutRedirect()).catch(() => undefined);
  };
  return <>{children({ session: state.session, signOut })}</>;
}
