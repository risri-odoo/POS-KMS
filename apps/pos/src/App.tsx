import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AlertTriangle, ClipboardList, UtensilsCrossed } from 'lucide-react';
import { AppShell, HeaderDate, type NavSection } from '@stayx/ui';
import { version } from '../package.json';
import { ApiError, listMenu, lookupStays, messageOf, placeOrder } from './api.js';
import { initialStayConfirm, orderBinding, stayConfirmReducer } from './stay-confirm.js';
import { cartReducer, cartSubtotal, emptyCart, unavailableLines } from './cart.js';
import { resolvePropertyId } from './config.js';
import { formatPrice, toMinor } from './money.js';
import { sortMenu } from './menu.js';
import { MenuManager } from './components/MenuManager.js';
import { NewOrder } from './components/NewOrder.js';
import { Notice, type NoticeMessage } from './components/Notice.js';
import { PropertyForm } from './components/PropertyForm.js';
import type { MenuItem } from './types.js';
import { useOrdersFeed } from './useOrdersFeed.js';

export function App() {
  const propertyId = resolvePropertyId(window.location.search, import.meta.env.VITE_DEFAULT_PROPERTY_ID);
  if (!propertyId) {
    return <PropertyForm initial={new URLSearchParams(window.location.search).get('propertyId') ?? ''} />;
  }
  return <Pos propertyId={propertyId} />;
}

type Tab = 'order' | 'menu';

function tabFromHash(): Tab {
  return window.location.hash === '#menu' ? 'menu' : 'order';
}

/** Plain hash links: the active tab lives in the URL, no router. */
function navFor(tab: Tab): NavSection[] {
  return [
    {
      items: [
        { href: '#order', label: 'Orders', icon: ClipboardList, active: tab === 'order' },
        { href: '#menu', label: 'Menu', icon: UtensilsCrossed, active: tab === 'menu' },
      ],
    },
    {
      title: 'Back office',
      items: [{ href: '#outbox', label: 'Outbox/Errors', icon: AlertTriangle, disabled: true, hint: 'Soon' }],
    },
  ];
}

function Pos({ propertyId }: { propertyId: string }) {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [cart, dispatchCart] = useReducer(cartReducer, emptyCart);
  const [roomNumber, setRoomNumber] = useState('');
  const [stay, dispatchStay] = useReducer(stayConfirmReducer, initialStayConfirm);
  const [orderNotes, setOrderNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const notify = useCallback((kind: NoticeMessage['kind'], text: string) => setNotice({ kind, text }), []);
  const notifyError = useCallback((text: string) => notify('error', text), [notify]);
  const { orders, connection, addPlaced } = useOrdersFeed(propertyId, notifyError);

  const cartRef = useRef(cart);
  cartRef.current = cart;

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

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
      nav={navFor(tab)}
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
      ) : (
        <MenuManager propertyId={propertyId} menu={menu} onMenuChange={onMenuChange} notify={notify} />
      )}
    </AppShell>
  );
}
