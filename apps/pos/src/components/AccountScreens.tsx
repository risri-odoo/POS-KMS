import type { ReactNode } from 'react';
import { Button, Card, Spinner } from '@stayx/ui';

/** A full-page message before the POS itself can open (sign-in, account problems). */
export function AccountScreen({ title, children, onSignOut }: { title: string; children?: ReactNode; onSignOut?: () => void }) {
  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <Card padding="lg" className="flex w-full max-w-lg flex-col gap-4">
        <h1 className="text-2xl font-semibold text-telivity-navy">StayX POS</h1>
        <h2 className="text-lg font-semibold text-telivity-navy">{title}</h2>
        {children}
        {onSignOut && (
          <Button variant="secondary" onClick={onSignOut} className="min-h-11 self-start">
            Sign out
          </Button>
        )}
      </Card>
    </main>
  );
}

export function SigningIn() {
  return (
    <main className="flex min-h-full items-center justify-center gap-3 p-4 text-telivity-slate" role="status">
      <Spinner /> Signing in…
    </main>
  );
}

/** For a user whose token lists several hotels and none was asked for in the URL. */
export function PropertyChooser({ options, onSignOut }: { options: string[]; onSignOut: () => void }) {
  const hrefFor = (propertyId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('propertyId', propertyId);
    return url.toString();
  };
  return (
    <AccountScreen title="Choose a hotel" onSignOut={onSignOut}>
      <ul className="flex flex-col gap-2">
        {options.map((id) => (
          <li key={id}>
            <a href={hrefFor(id)} className="block rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm text-telivity-navy hover:bg-gray-50">
              {id}
            </a>
          </li>
        ))}
      </ul>
    </AccountScreen>
  );
}
