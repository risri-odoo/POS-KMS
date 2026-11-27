import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AlertTriangle, ClipboardList, LogOut, UtensilsCrossed } from 'lucide-react';
import { AppShell, Button, HeaderDate, type NavSection } from '@stayx/ui';
import { version } from '../package.json';
import { ApiError, getCurrentProperty, listMenu, lookupStays, messageOf, placeOrder } from './api.js';
import { initialStayConfirm, orderBinding, stayConfirmReducer } from './stay-confirm.js';
import { cartReducer, cartSubtotal, emptyCart, unavailableLines } from './cart.js';
import { resolvePropertyId } from './config.js';
import { formatPrice, toMinor } from './money.js';
import { sortMenu } from './menu.js';
import { MenuManager } from './components/MenuManager.js';
import { OutboxPanel } from './components/OutboxPanel.js';
import { NewOrder } from './components/NewOrder.js';
import { Notice, type NoticeMessage } from './components/Notice.js';
import { PropertyForm } from './components/PropertyForm.js';
import type { MenuItem, PublicProperty } from './types.js';
import { useOrdersFeed } from './useOrdersFeed.js';
import { useOutboxAlerts } from './useOutboxAlerts.js';
import { navAlert, pageTitle } from './outbox-alerts.js';
import { AuthGate, type SignedIn } from './auth/AuthGate.js';
import { setBeforeSignIn } from './auth/before-sign-in.js';
import { clearCartStash, peekCartStash, saveCartStash, type CartStash } from './auth/cart-stash.js';
import { authSettings, canManage, canOrder, pickProperty, roleLabels } from '@stayx/web-common/auth';
import { AccountScreen, PropertyChooser } from './components/AccountScreens.js';

/** Read once: AuthGate's effect depends on this object staying the same. */
const AUTH = authSettings(import.meta.env, 'stayx-pos-web');

/** sessionStorage, or null where the browser blocks it. */
function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function App() {
  const requested = resolvePropertyId(window.location.search, import.meta.env.VITE_DEFAULT_PROPERTY_ID);
  if (!AUTH.enabled) {
    // Login off (local development): as before, any property.
    if (!requested) {
      return <PropertyForm initial={new URLSearchParams(window.location.search).get('propertyId') ?? ''} />;
    }
    return <Pos propertyId={requested} user={null} />;
  }
  return <AuthGate settings={AUTH}>{(signedIn) => <SignedInPos requested={requested} signedIn={signedIn} />}</AuthGate>;
}

/** Roles and hotels from the token decide what opens (§8.6). The API enforces the same rules. */
function SignedInPos({ requested, signedIn }: { requested: string | null; signedIn: SignedIn }) {
  const { session, signOut } = signedIn;
  if (!canOrder(session.roles)) {
    return (
      <AccountScreen title="This account can't take orders" onSignOut={signOut}>
        <p className="text-sm text-telivity-slate">
          {session.username} has no POS ordering role (Staff or Manager)
          {session.roles.length > 0 ? `; it has: ${roleLabels(session.roles)}` : ''}. Ask a manager to add the role, or sign
          in with another account.
        </p>
      </AccountScreen>
    );
  }
  const choice = pickProperty(requested, session.propertyIds);
  if (choice.kind === 'none') {
    return (
      <AccountScreen title="No hotel is assigned to this account" onSignOut={signOut}>
        <p className="text-sm text-telivity-slate">Ask a manager to give {session.username} access to a hotel.</p>
      </AccountScreen>
    );
  }
  if (choice.kind === 'choose') return <PropertyChooser options={choice.options} onSignOut={signOut} />;
  // Keyed by user: a different user always starts with a fresh screen and an empty cart.
  return <Pos key={session.sub} propertyId={choice.propertyId} user={signedIn} />;
}

type Tab = 'order' | 'menu' | 'outbox';

/** Menu and Outbox/Errors are for managers; anyone else lands on Orders. */
export function tabFromHash(hash: string, isManager: boolean): Tab {
  if (isManager && hash === '#menu') return 'menu';
  if (isManager && hash === '#outbox') return 'outbox';
  return 'order';
}

/**
 * Plain hash links: the active tab lives in the URL, no router. Menu editing and the
 * back office are for managers only (§8.6); with login off everything shows, as before.
 */
export function navFor(tab: Tab, isManager: boolean, outboxAlert: { badge?: number; alert?: string } = {}): NavSection[] {
  const orders = { href: '#order', label: 'Orders', icon: ClipboardList, active: tab === 'order' };
  if (!isManager) return [{ items: [orders] }];
  return [
    { items: [orders, { href: '#menu', label: 'Menu', icon: UtensilsCrossed, active: tab === 'menu' }] },
    {
      title: 'Back office',
      items: [{ href: '#outbox', label: 'Outbox/Errors', icon: AlertTriangle, active: tab === 'outbox', ...outboxAlert }],
    },
  ];
}

function Pos({ propertyId, user }: { propertyId: string; user: SignedIn | null }) {
  const isManager = user ? canManage(user.session.roles) : true;
  const [tab, setTab] = useState<Tab>(() => tabFromHash(window.location.hash, isManager));
  const tabRef = useRef(tab);
  tabRef.current = tab;
  // After signing in again, the order that was being built (§8.6). Read without removing,
  // because StrictMode runs initialisers twice; removed in the effect below.
  const [kept] = useState<CartStash | null>(() => {
    const storage = user ? tabStorage() : null;
    return storage && user ? peekCartStash(storage, propertyId, user.session.sub, Date.now()) : null;
  });
  const [notice, setNotice] = useState<NoticeMessage | null>(() =>
    kept ? { kind: 'success', text: 'Your order in progress was kept after signing in again. Confirm the guest again before placing it.' } : null,
  );
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [property, setProperty] = useState<PublicProperty | null>(null);
  const [cart, dispatchCart] = useReducer(cartReducer, kept?.cart ?? emptyCart);
  const [roomNumber, setRoomNumber] = useState(kept?.roomNumber ?? '');
  const [stay, dispatchStay] = useReducer(stayConfirmReducer, initialStayConfirm);
  const [orderNotes, setOrderNotes] = useState(kept?.orderNotes ?? '');

  // What to keep if the session ends while this order is being built.
  const inProgress = useRef({ cart, roomNumber, orderNotes });
  inProgress.current = { cart, roomNumber, orderNotes };
  const userSub = user?.session.sub ?? null;
  useEffect(() => {
    const storage = tabStorage();
    if (userSub === null || !storage) return;
    // Used (or not ours): either way it must not come back later.
    clearCartStash(storage);
    setBeforeSignIn(() => saveCartStash(storage, { propertyId, userSub, ...inProgress.current, savedAt: Date.now() }));
    return () => setBeforeSignIn(null);
  }, [userSub, propertyId]);
  const [submitting, setSubmitting] = useState(false);

  const notify = useCallback((kind: NoticeMessage['kind'], text: string) => setNotice({ kind, text }), []);
  const notifyError = useCallback((text: string) => notify('error', text), [notify]);
  // Managers: the count of charges needing attention (AUDIT.md item 15). The socket below feeds it live.
  const alertsHandle = useRef<(e: { propertyId?: string; count?: number }) => void>(() => undefined);
  const { orders, connection, addPlaced } = useOrdersFeed(propertyId, notifyError, (e) => alertsHandle.current(e));
  const { alerts, onAttentionChanged, refreshAlerts } = useOutboxAlerts(propertyId, isManager, connection, (text) => {
    if (tabRef.current !== 'outbox') notify('error', text);
  });
  alertsHandle.current = onAttentionChanged;
  useEffect(() => {
    document.title = pageTitle('StayX POS', alerts);
  }, [alerts]);

  const cartRef = useRef(cart);
  cartRef.current = cart;

  useEffect(() => {
    const onHash = () => setTab(tabFromHash(window.location.hash, isManager));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [isManager]);

  // The hotel's name and currency (shown on the menu screen).
  useEffect(() => {
    let alive = true;
    getCurrentProperty(propertyId).then(
      (p) => alive && setProperty(p),
      (error: unknown) => alive && notify('error', `Could not load the hotel: ${messageOf(error)}`),
    );
    return () => {
      alive = false;
    };
  }, [propertyId, notify]);

  // The latest menu, so successive updates (e.g. optimistic toggle, then the
  // server's row) compose instead of each starting from a stale render.
  const menuRef = useRef<MenuItem[] | null>(null);

  /** Replace the menu and keep the cart consistent with it (prices, availability). */
  const applyMenu = useCallback((next: MenuItem[]) => {
    const dropped = unavailableLines(cartRef.current, next);
    const sorted = sortMenu(next);
    menuRef.current = sorted;
    setMenu(sorted);
    dispatchCart({ type: 'syncMenu', menu: next });
    if (dropped.length > 0) {
      setNotice({
        kind: 'error',
        text: `Removed from cart (no longer available): ${dropped.map((l) => l.name).join(', ')}`,
      });
    }
  }, []);

  const refreshMenu = useCallback(async () => {
    try {
      applyMenu(await listMenu(propertyId));
    } catch (error) {
      notify('error', `Could not load the menu: ${messageOf(error)}`);
    }
  }, [propertyId, applyMenu, notify]);

  // Load on start and on every tab switch, so both screens see the latest menu.
  useEffect(() => {
    void refreshMenu();
  }, [tab, refreshMenu]);

  const onMenuChange = useCallback(
    (update: (menu: MenuItem[]) => MenuItem[]) => applyMenu(update(menuRef.current ?? [])),
    [applyMenu],
  );

  const onRoomNumber = useCallback((value: string) => {
    setRoomNumber(value);
    // A different room means a different guest: the reducer drops the choice and the tick.
    dispatchStay({ type: 'roomChanged', room: value });
  }, []);

  const runLookup = useCallback(
    async (room: string) => {
      dispatchStay({ type: 'lookupStarted', room });
      try {
        dispatchStay({ type: 'lookupDone', room, response: await lookupStays(propertyId, room) });
      } catch (error) {
        dispatchStay({ type: 'lookupFailed', room, message: messageOf(error) });
      }
    },
    [propertyId],
  );

  const onPlaceOrder = useCallback(async () => {
    if (submitting) return; // the button is disabled too; the API has no idempotency key
    const room = roomNumber.trim();
    const binding = orderBinding(stay);
    if (!room || cart.lines.length === 0 || !binding) return;
    const estimate = cartSubtotal(cart);

    setSubmitting(true);
    try {
      // Never send prices: the server prices every line from the menu.
      const order = await placeOrder({
        propertyId,
        roomNumber: room,
        items: cart.lines.map((l) => ({
          menuItemId: l.menuItemId,
          quantity: l.quantity,
          ...(l.note.trim() ? { notes: l.note.trim() } : {}),
        })),
        ...(orderNotes.trim() ? { notes: orderNotes.trim() } : {}),
        placedBy: 'pos',
        ...binding,
      });
      dispatchCart({ type: 'clear' });
      setRoomNumber('');
      dispatchStay({ type: 'orderPlaced' });
      setOrderNotes('');
      addPlaced(order);

      const repriced = estimate.kind === 'ok' && toMinor(order.subtotal) !== estimate.minor;
      notify(
        'success',
        `Order ${order.orderNumber} placed for room ${order.roomNumber}: ${formatPrice(order.subtotal, order.currencyCode)}` +
          (repriced ? ' (menu prices changed; menu refreshed)' : ''),
      );
      if (repriced) void refreshMenu();
    } catch (error) {
      notify('error', `Order not placed: ${messageOf(error)}`);
      if (error instanceof ApiError && (error.status === 409 || error.status === 503)) {
        // The server's stay check failed (stay ended, name not on it, or the lookup works
        // again): drop the choice, show why, and look the room up again.
        dispatchStay({ type: 'orderRejected', message: messageOf(error) });
        void runLookup(room);
      }
      // 400 usually means an item became unavailable or the menu changed.
      if (error instanceof ApiError && error.status === 400) void refreshMenu();
    } finally {
      setSubmitting(false);
    }
  }, [submitting, roomNumber, stay, cart, orderNotes, propertyId, addPlaced, notify, refreshMenu, runLookup]);

  return (
    <AppShell
      brand="StayX POS"
      tagline="Room service"
      nav={navFor(tab, isManager, navAlert(alerts))}
      connection={connection}
      fill
      mainClassName={`overflow-y-auto p-3 sm:p-4 lg:p-6 ${tab === 'order' ? 'lg:overflow-hidden' : ''}`}
      footer={`v${version}`}
      headerStart={
        <>
          <span className="rounded-lg border border-gray-200 px-3 py-1.5 font-mono text-sm text-telivity-slate" title={propertyId}>
            {propertyId.slice(0, 8)}
          </span>
          <HeaderDate />
        </>
      }
      headerEnd={
        user ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden text-right leading-tight sm:block">
              <span className="block font-semibold text-telivity-navy">{user.session.username}</span>
              <span className="block text-xs text-telivity-slate">{roleLabels(user.session.roles)}</span>
            </span>
            <Button variant="ghost" icon={LogOut} onClick={user.signOut} title="Sign out">
              Sign out
            </Button>
          </div>
        ) : (
          <span className="rounded-lg border border-telivity-orange px-2 py-1 text-xs font-semibold text-telivity-orange" title="POS_AUTH_ENABLED=false and no VITE_OIDC_AUTHORITY: development only">
            Login off
          </span>
        )
      }
      banner={
        connection === 'disconnected' && (
          <div role="alert" className="border-b border-telivity-orange bg-telivity-orange/10 px-4 py-2 text-center text-sm font-semibold text-telivity-navy">
            Live updates disconnected. Reconnecting… Orders can still be placed.
          </div>
        )
      }
    >
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      {tab === 'order' ? (
        <NewOrder
          menu={menu}
          cart={cart}
          dispatchCart={dispatchCart}
          roomNumber={roomNumber}
          onRoomNumber={onRoomNumber}
          stay={stay}
          onFindGuest={() => void runLookup(roomNumber.trim())}
          onSelectGuest={(reservationId, displayName) => dispatchStay({ type: 'guestSelected', reservationId, displayName })}
          onToggleUnverified={(confirmed) => dispatchStay({ type: 'unverifiedToggled', confirmed })}
          orderNotes={orderNotes}
          onOrderNotes={setOrderNotes}
          submitting={submitting}
          onPlaceOrder={() => void onPlaceOrder()}
          recent={orders}
        />
      ) : tab === 'menu' ? (
        <MenuManager propertyId={propertyId} currencyCode={property?.currencyCode ?? null} menu={menu} onMenuChange={onMenuChange} notify={notify} />
      ) : (
        <OutboxPanel propertyId={propertyId} notify={notify} bridgeEnabled={alerts.bridgeEnabled} onChanged={() => void refreshAlerts()} />
      )}
    </AppShell>
  );
}
