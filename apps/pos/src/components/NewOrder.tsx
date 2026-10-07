import { useEffect, useMemo, useState, type Dispatch } from 'react';
import { MAX_QUANTITY, MIN_QUANTITY, cartSubtotal, type CartAction, type CartState } from '../cart.js';
import { formatMoney, formatPrice } from '../money.js';
import { STATUS_BADGE, STATUS_LABEL, formatAge, groupAvailableMenu } from '../menu.js';
import type { FeedOrder, MenuItem } from '../types.js';

const CLOCK_TICK_MS = 30_000;

interface Props {
  menu: MenuItem[] | null;
  cart: CartState;
  dispatchCart: Dispatch<CartAction>;
  roomNumber: string;
  onRoomNumber: (v: string) => void;
  orderNotes: string;
  onOrderNotes: (v: string) => void;
  submitting: boolean;
  onPlaceOrder: () => void;
  recent: FeedOrder[];
}

export function NewOrder(props: Props) {
  return (
    <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <section className="flex min-h-0 flex-col gap-3 overflow-y-auto" aria-label="Menu">
        <MenuTiles menu={props.menu} onAdd={(item) => props.dispatchCart({ type: 'add', item })} />
        <RecentOrders orders={props.recent} />
      </section>
      <CartPanel {...props} />
    </div>
  );
}

function MenuTiles({ menu, onAdd }: { menu: MenuItem[] | null; onAdd: (item: MenuItem) => void }) {
  const groups = useMemo(() => groupAvailableMenu(menu ?? []), [menu]);
  if (menu === null) return <p className="p-4 text-lg text-neutral-400">Loading menu…</p>;
  if (groups.length === 0) {
    return (
      <p className="rounded-xl bg-neutral-900 p-6 text-lg text-neutral-400">
        No available menu items. Add some on the <a href="#menu" className="text-emerald-400 underline">Menu</a> tab.
      </p>
    );
  }
  return (
    <>
      {groups.map((group) => (
        <div key={group.category}>
          <h2 className="mb-2 text-xl font-bold text-neutral-300">{group.category}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onAdd(item)}
                className="flex min-h-24 flex-col justify-between rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-left active:bg-neutral-800"
              >
                <span className="text-lg font-semibold leading-tight">{item.name}</span>
                <span className="text-lg tabular-nums text-emerald-300">{formatPrice(item.price, item.currencyCode)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function CartPanel({
  cart,
  dispatchCart,
  roomNumber,
  onRoomNumber,
  orderNotes,
  onOrderNotes,
  submitting,
  onPlaceOrder,
}: Props) {
  const subtotal = cartSubtotal(cart);
  // Disabled while a request is in flight: the API has no idempotency key yet,
  // so a double tap would otherwise create two orders.
  const canPlace = cart.lines.length > 0 && roomNumber.trim() !== '' && subtotal.kind !== 'mixed' && !submitting;

  return (
    <aside className="flex min-h-0 flex-col gap-3 rounded-xl bg-neutral-900 p-4" aria-label="Cart">
      <h2 className="text-2xl font-bold">Order</h2>

      <label className="flex flex-col gap-1 text-lg">
        <span className="text-neutral-300">Room number *</span>
        <input
          value={roomNumber}
          onChange={(e) => onRoomNumber(e.target.value)}
          maxLength={20}
          inputMode="text"
          autoComplete="off"
          className="min-h-12 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-2xl font-bold"
        />
      </label>

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {cart.lines.length === 0 && <li className="py-6 text-center text-lg text-neutral-500">Tap menu items to add them.</li>}
        {cart.lines.map((line) => (
          <li key={line.menuItemId} className="flex flex-col gap-2 rounded-lg bg-neutral-800 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-lg font-semibold">{line.name}</span>
              <span className="tabular-nums text-neutral-300">{formatPrice(line.unitPrice, line.currencyCode)}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={`One less ${line.name}`}
                disabled={line.quantity <= MIN_QUANTITY}
                onClick={() => dispatchCart({ type: 'setQuantity', menuItemId: line.menuItemId, quantity: line.quantity - 1 })}
                className="min-h-12 min-w-12 rounded-lg bg-neutral-700 text-2xl font-bold disabled:opacity-40"
              >
                −
              </button>
              <span className="min-w-10 text-center text-2xl font-bold tabular-nums" aria-live="polite">
                {line.quantity}
              </span>
              <button
                type="button"
                aria-label={`One more ${line.name}`}
                disabled={line.quantity >= MAX_QUANTITY}
                onClick={() => dispatchCart({ type: 'setQuantity', menuItemId: line.menuItemId, quantity: line.quantity + 1 })}
                className="min-h-12 min-w-12 rounded-lg bg-neutral-700 text-2xl font-bold disabled:opacity-40"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => dispatchCart({ type: 'remove', menuItemId: line.menuItemId })}
                className="ml-auto min-h-12 rounded-lg px-3 text-lg font-semibold text-red-300 hover:bg-neutral-700"
              >
                Remove
              </button>
            </div>
            <input
              value={line.note}
              onChange={(e) => dispatchCart({ type: 'setNote', menuItemId: line.menuItemId, note: e.target.value })}
              maxLength={500}
              placeholder="Note (e.g. no onions)"
              aria-label={`Note for ${line.name}`}
              className="min-h-12 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-base"
            />
          </li>
        ))}
      </ul>

      <label className="flex flex-col gap-1 text-lg">
        <span className="text-neutral-300">Order notes</span>
        <textarea
          value={orderNotes}
          onChange={(e) => onOrderNotes(e.target.value)}
          maxLength={1000}
          rows={2}
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-base"
        />
      </label>

      <div className="flex items-baseline justify-between text-xl">
        <span className="text-neutral-300">Subtotal</span>
        <span className="font-bold tabular-nums">
          {subtotal.kind === 'ok' && formatMoney(subtotal.minor, subtotal.currencyCode)}
          {subtotal.kind === 'empty' && '—'}
          {subtotal.kind === 'mixed' && <span className="text-amber-400">Mixed currencies</span>}
        </span>
      </div>
      <p className="-mt-2 text-sm text-neutral-500">Estimate. The server prices the order from the current menu.</p>

      <button
        type="button"
        disabled={!canPlace}
        onClick={onPlaceOrder}
        className="min-h-16 rounded-xl bg-emerald-600 text-2xl font-bold text-white active:bg-emerald-700 disabled:opacity-40"
      >
        {submitting ? 'Placing…' : 'Place order'}
      </button>
    </aside>
  );
}

function RecentOrders({ orders }: { orders: FeedOrder[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="mt-2">
      <h2 className="mb-2 text-xl font-bold text-neutral-300">Recent orders</h2>
      {orders.length === 0 ? (
        <p className="text-lg text-neutral-500">No orders yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {orders.map((o) => (
            <li key={o.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-lg bg-neutral-900 px-3 py-2 text-lg">
              <span className={`rounded-md px-2 py-0.5 text-sm font-bold ${STATUS_BADGE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
              <span>
                <span className="font-bold">Room {o.roomNumber}</span>
                <span className="ml-2 font-mono text-sm text-neutral-400">{o.orderNumber}</span>
              </span>
              <span className="tabular-nums">{formatPrice(o.subtotal, o.currencyCode)}</span>
              <span className="min-w-20 text-right text-sm text-neutral-400 tabular-nums">{formatAge(o.createdAt, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
