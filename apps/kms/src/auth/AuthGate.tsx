import { useEffect, useReducer, useState, type ReactNode } from 'react';
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { Button, Card, Spinner } from '@stayx/ui';
import { setAuthHooks } from './auth-hooks.js';
import { SILENT_RETRY_MS, sessionReducer, type SessionStatus } from './recovery.js';
import { safeReturnPath, sessionFromAccessToken, type AuthSettings, type Session } from './session.js';

export interface SignedIn {
  session: Session;
  /** 'lost': renewal failed; the board stays up with a "Sign in again" banner. */
  status: SessionStatus;
  /** Goes up on every token load, so the socket can reconnect with the new token. */
  version: number;
  signInAgain: () => void;
  signOut: () => void;
}

type OidcSettings = Extract<AuthSettings, { enabled: true }>;
type GateState = { kind: 'loading' } | { kind: 'signed-in'; session: Session; version: number } | { kind: 'error'; message: string };

// One manager and one start per page load (StrictMode runs effects twice in development).
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
    automaticSilentRenew: true,
    // localStorage, unlike the POS: a kitchen tablet should stay signed in across a
    // browser restart, within the provider's session limits (§8.6, tablet sessions).
    userStore: new WebStorageStateStore({ store: window.localStorage }),
  });
  return manager;
}

function start(m: UserManager): Promise<User | null> {
  starting ??= (async () => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('error') && params.has('state')) {
      throw new Error(params.get('error_description') ?? params.get('error') ?? 'sign-in failed');
    }
    if (params.has('code') && params.has('state')) {
      const user = await m.signinRedirectCallback();
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

function signIn(m: UserManager, onError: (message: string) => void) {
  if (redirecting) return;
  redirecting = true;
  const { pathname, search, hash } = window.location;
  m.signinRedirect({ state: { returnTo: pathname + search + hash } }).catch((error: unknown) => {
    redirecting = false;
    onError(error instanceof Error ? error.message : 'could not reach the sign-in page');
  });
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <Card padding="lg" className="flex w-full max-w-lg flex-col gap-4 text-lg">
        {children}
      </Card>
    </main>
  );
}

/**
 * Signs the tablet's account in and renders the board for it (INTEGRATION_DESIGN.md §8.6).
 * Unlike the POS, a session that ends later does NOT leave the page: the board stays up
 * with a "Sign in again" banner, and a quiet renewal is retried every minute.
 */
export function AuthGate({ settings, children }: { settings: OidcSettings; children: (signedIn: SignedIn) => ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'loading' });
  const [status, dispatchStatus] = useReducer(sessionReducer, 'active');

  useEffect(() => {
    const m = managerFor(settings);
    let alive = true;
    let signedIn = false;
    const fail = (message: string) => {
      if (alive) setState({ kind: 'error', message });
    };
    const loaded = (user: User) => {
      if (!alive) return;
      signedIn = true;
      dispatchStatus({ type: 'renewed' });
      setState((s) => ({ kind: 'signed-in', session: sessionFromAccessToken(user.access_token), version: s.kind === 'signed-in' ? s.version + 1 : 1 }));
    };
    // Before the first sign-in there is no board to keep: go to the sign-in page.
    const ended = () => (signedIn ? dispatchStatus({ type: 'ended' }) : signIn(m, fail));

    setAuthHooks({
      getToken: async () => {
        const user = await m.getUser();
        return user && !user.expired ? user.access_token : null;
      },
      sessionEnded: ended,
    });
    m.events.addUserLoaded(loaded);
    m.events.addAccessTokenExpired(ended);

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

  // While signed out, keep trying a quiet renewal (Wi-Fi blips); success fires addUserLoaded.
  useEffect(() => {
    if (status !== 'lost') return;
    const m = managerFor(settings);
    const timer = setInterval(() => void m.signinSilent().catch(() => undefined), SILENT_RETRY_MS);
    return () => clearInterval(timer);
  }, [status, settings]);

  if (state.kind === 'loading') {
    return (
      <main className="flex min-h-full items-center justify-center gap-3 p-4 text-xl text-telivity-slate" role="status">
        <Spinner /> Signing in…
      </main>
    );
  }
  if (state.kind === 'error') {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold text-telivity-navy">Could not sign in</h1>
        <p className="text-telivity-slate">{state.message}</p>
        <Button onClick={() => window.location.assign('/')} className="min-h-12 self-start">
          Try again
        </Button>
      </Centered>
    );
  }

  const m = managerFor(settings);
  return (
    <>
      {children({
        session: state.session,
        status,
        version: state.version,
        signInAgain: () => signIn(m, (message) => setState({ kind: 'error', message })),
        signOut: () => void m.signoutRedirect().catch(() => undefined),
      })}
    </>
  );
}

/** For accounts that may not run the board, or have no hotel. */
export function AccountMessage({ title, detail, onSignOut }: { title: string; detail: string; onSignOut: () => void }) {
  return (
    <Centered>
      <h1 className="text-2xl font-semibold text-telivity-navy">StayX Kitchen</h1>
      <h2 className="text-xl font-semibold text-telivity-navy">{title}</h2>
      <p className="text-telivity-slate">{detail}</p>
      <Button variant="secondary" onClick={onSignOut} className="min-h-12 self-start">
        Sign out
      </Button>
    </Centered>
  );
}
