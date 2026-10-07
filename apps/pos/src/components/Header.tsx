import type { ConnectionState } from '../useOrdersFeed.js';

export type Tab = 'order' | 'menu';

interface Props {
  propertyId: string;
  tab: Tab;
  connection: ConnectionState;
}

const DOT: Record<ConnectionState, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-400 animate-pulse',
  disconnected: 'bg-red-500 animate-pulse',
};

const LABEL: Record<ConnectionState, string> = {
  connected: 'Live',
  connecting: 'Connecting',
  disconnected: 'Offline',
};

const TABS: { id: Tab; label: string }[] = [
  { id: 'order', label: 'New order' },
  { id: 'menu', label: 'Menu' },
];

export function Header({ propertyId, tab, connection }: Props) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-900 px-4 py-2">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-bold tracking-tight">POS</h1>
        <span className="font-mono text-base text-neutral-400" title={propertyId}>
          {propertyId.slice(0, 8)}
        </span>
      </div>

      {/* Tabs are plain hash links: the active tab lives in the URL, no router. */}
      <nav className="flex gap-2" aria-label="Sections">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`flex min-h-12 items-center rounded-lg px-5 text-lg font-semibold ${
              tab === t.id ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            {t.label}
          </a>
        ))}
      </nav>

      <span className="flex items-center gap-2 text-lg text-neutral-300" aria-live="polite">
        <span className={`inline-block h-4 w-4 rounded-full ${DOT[connection]}`} aria-hidden />
        {LABEL[connection]}
      </span>
    </header>
  );
}
