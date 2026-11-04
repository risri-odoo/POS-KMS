// Adapted from HAIP apps/dashboard/src/components/layout/{AppLayout,Sidebar,Header}.tsx (commit 928c2f6).
// Copyright 2026 Telivity. Licensed under the Apache License, Version 2.0; see ../../LICENSE.haip.
// Modified for StayX: router, auth, i18n, property switcher, search, help and notifications
// removed; nav passed in as props; disabled nav items, a banner slot, a fixed-height mode
// and a sidebar-free layout added.
import { useState, type ReactNode } from 'react';
import { Menu, X, type LucideIcon } from 'lucide-react';

export type ConnectionState = 'connected' | 'connecting' | 'disconnected';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  /** Shown greyed out, for a section that doesn't exist yet. */
  disabled?: boolean;
  hint?: string;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

interface AppShellProps {
  brand: string;
  tagline?: string;
  /** Leave out for a top-bar-only layout, such as the kitchen display. */
  nav?: NavSection[];
  connection?: ConnectionState;
  headerStart?: ReactNode;
  headerEnd?: ReactNode;
  /** Full-width alerts between the top bar and the page. */
  banner?: ReactNode;
  footer?: ReactNode;
  /** Fit the window and let the page manage its own scrolling. */
  fill?: boolean;
  mainClassName?: string;
  children: ReactNode;
}

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connected: 'Live',
  connecting: 'Connecting',
  disconnected: 'Offline',
};

const CONNECTION_DOT: Record<ConnectionState, string> = {
  connected: 'bg-telivity-dark-teal',
  connecting: 'bg-telivity-orange animate-pulse',
  disconnected: 'bg-telivity-orange',
};

function ConnectionStatus({ state }: { state: ConnectionState }) {
  return (
    <div className="flex items-center gap-1.5" aria-live="polite">
      <div className={`h-2 w-2 rounded-full ${CONNECTION_DOT[state]}`} aria-hidden="true" />
      <span className="text-xs text-telivity-slate">{CONNECTION_LABEL[state]}</span>
    </div>
  );
}

const TODAY_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

/** Today's date for the top bar, hidden on small screens as in HAIP. */
export function HeaderDate() {
  return <span className="hidden text-sm text-telivity-mid-grey md:inline">{TODAY_FORMAT.format(new Date())}</span>;
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const { href, label, icon: Icon, active, disabled, hint } = item;
  if (disabled) {
    return (
      <span aria-disabled="true" className="flex cursor-not-allowed items-center gap-3 px-6 py-2.5 text-sm font-medium text-white/40">
        <Icon size={18} aria-hidden="true" />
        <span className="flex-1">{label}</span>
        {hint && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">{hint}</span>}
      </span>
    );
  }
  return (
    <a
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 px-6 py-2.5 text-sm font-medium transition-colors ${
        active ? 'bg-telivity-teal/15 text-telivity-teal' : 'text-white/70 hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon size={18} aria-hidden="true" />
      {label}
    </a>
  );
}

export function AppShell({
  brand,
  tagline,
  nav,
  connection,
  headerStart,
  headerEnd,
  banner,
  footer,
  fill = false,
  mainClassName = 'p-3 sm:p-4 lg:p-6',
  children,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const close = () => setSidebarOpen(false);
  const hasSidebar = Boolean(nav?.length);

  return (
    <div className={`bg-telivity-light-grey ${fill ? 'h-dvh overflow-hidden' : 'min-h-dvh'}`}>
      {hasSidebar && (
        <>
          {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={close} />}
          <aside
            className={`fixed top-0 left-0 z-50 flex h-dvh w-60 flex-col bg-telivity-navy text-white transition-transform duration-200 lg:translate-x-0 ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
              <div className="min-w-0">
                <p className="truncate text-xl font-semibold tracking-wide">{brand}</p>
                {tagline && <p className="mt-0.5 truncate text-xs text-white/60">{tagline}</p>}
              </div>
              <button type="button" onClick={close} className="flex-shrink-0 rounded-sm p-1 hover:bg-white/10 lg:hidden" aria-label="Close menu">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-3" aria-label="Main navigation">
              {nav?.map((section, index) => (
                <div key={section.title ?? index}>
                  {section.title && (
                    <p className="px-6 pt-4 pb-1 text-[10px] font-semibold tracking-wider text-white/40 uppercase">{section.title}</p>
                  )}
                  {section.items.map((item) => (
                    <NavLink key={item.href} item={item} onNavigate={close} />
                  ))}
                </div>
              ))}
            </nav>
            {footer && <div className="border-t border-white/10 px-6 py-4 text-xs text-telivity-mid-grey">{footer}</div>}
          </aside>
        </>
      )}

      <div className={`flex flex-col ${fill ? 'h-full' : 'min-h-dvh'} ${hasSidebar ? 'lg:ml-60' : ''}`}>
        <header className="flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            {hasSidebar && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="-ml-1 rounded-lg p-2 hover:bg-telivity-light-grey lg:hidden"
                aria-label="Open menu"
              >
                <Menu size={20} className="text-telivity-slate" aria-hidden="true" />
              </button>
            )}
            {!hasSidebar && <p className="text-xl font-semibold tracking-wide text-telivity-navy">{brand}</p>}
            {headerStart}
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            {connection && <ConnectionStatus state={connection} />}
            {headerEnd}
          </div>
        </header>
        {banner}
        <main className={`flex min-h-0 flex-1 flex-col ${mainClassName}`}>{children}</main>
      </div>
    </div>
  );
}
