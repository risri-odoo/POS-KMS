import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ApiError, listMenu, messageOf, placeOrder } from './api.js';
import { cartReducer, cartSubtotal, emptyCart, unavailableLines } from './cart.js';
import { propertyIdFromSearch } from './config.js';
import { formatPrice, toMinor } from './money.js';
import { sortMenu } from './menu.js';
import { Header, type Tab } from './components/Header.js';
import { MenuManager } from './components/MenuManager.js';
import { NewOrder } from './components/NewOrder.js';
import { Notice, type NoticeMessage } from './components/Notice.js';
import { PropertyForm } from './components/PropertyForm.js';
import type { MenuItem } from './types.js';
import { useOrdersFeed } from './useOrdersFeed.js';

export function App() {
  const propertyId = propertyIdFromSearch(window.location.search);
  if (!propertyId) {
    return <PropertyForm initial={new URLSearchParams(window.location.search).get('propertyId') ?? ''} />;
  }
  return <Pos propertyId={propertyId} />;
}

function tabFromHash(): Tab {
  return window.location.hash === '#menu' ? 'menu' : 'order';
}

function Pos({ propertyId }: { propertyId: string }) {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [cart, dispatchCart] = useReducer(cartReducer, emptyCart);
  const [roomNumber, setRoomNumber] = useState('');
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

  const onPlaceOrder = useCallback(async () => {
    if (submitting) return; // the button is disabled too; the API has no idempotency key
    const room = roomNumber.trim();
    if (!room || cart.lines.length === 0) return;
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
      });
      dispatchCart({ type: 'clear' });
      setRoomNumber('');
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
      // 400 usually means an item became unavailable or the menu changed.
      if (error instanceof ApiError && error.status === 400) void refreshMenu();
    } finally {
      setSubmitting(false);
    }
  }, [submitting, roomNumber, cart, orderNotes, propertyId, addPlaced, notify, refreshMenu]);

  return (
    <div className="flex h-full flex-col">
      <Header propertyId={propertyId} tab={tab} connection={connection} />
      {connection === 'disconnected' && (
        <div role="alert" className="bg-red-700 px-4 py-1 text-center text-lg font-semibold text-white">
          Live updates disconnected. Reconnecting… Orders can still be placed.
        </div>
      )}
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      {tab === 'order' ? (
        <NewOrder
          menu={menu}
          cart={cart}
          dispatchCart={dispatchCart}
          roomNumber={roomNumber}
          onRoomNumber={setRoomNumber}
          orderNotes={orderNotes}
          onOrderNotes={setOrderNotes}
          submitting={submitting}
          onPlaceOrder={() => void onPlaceOrder()}
          recent={orders}
        />
      ) : (
        <MenuManager propertyId={propertyId} menu={menu} onMenuChange={onMenuChange} notify={notify} />
      )}
    </div>
  );
}
