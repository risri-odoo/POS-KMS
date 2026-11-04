import { useEffect, useMemo, useState, type Dispatch } from 'react';
import { ClipboardList, Minus, Plus } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  OrderStatusBadge,
  PageHeader,
  Spinner,
  Table,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@stayx/ui';
import { MAX_QUANTITY, MIN_QUANTITY, cartSubtotal, type CartAction, type CartState } from '../cart.js';
import { formatMoney, formatPrice } from '../money.js';
import { formatAge, groupAvailableMenu } from '../menu.js';
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
    <>
      <PageHeader title="New order" icon={ClipboardList} className="mb-4!" />
      <div className="grid flex-1 grid-cols-[minmax(0,1fr)] gap-4 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        {/* Below lg the section dissolves, so the order classes put the cart between menu and recent orders. */}
        <section className="contents lg:flex lg:min-h-0 lg:flex-col lg:gap-4 lg:overflow-y-auto" aria-label="Menu">
          <div className="order-1 flex flex-col gap-4">
            <MenuTiles menu={props.menu} onAdd={(item) => props.dispatchCart({ type: 'add', item })} />
          </div>
          <div className="order-3">
            <RecentOrders orders={props.recent} />
          </div>
        </section>
        <CartPanel {...props} />
      </div>
    </>
  );
}

function MenuTiles({ menu, onAdd }: { menu: MenuItem[] | null; onAdd: (item: MenuItem) => void }) {
  const groups = useMemo(() => groupAvailableMenu(menu ?? []), [menu]);
  if (menu === null) {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-telivity-slate">
        <Spinner /> Loading menu…
      </p>
    );
  }
  if (groups.length === 0) {
    return (
      <Card padding="none">
        <EmptyState>
          No available menu items. Add some on the{' '}
          <a href="#menu" className="text-telivity-teal underline">
            Menu
          </a>{' '}
          tab.
        </EmptyState>
      </Card>
    );
  }
  return (
    <>
      {groups.map((group) => (
        <div key={group.category}>
          <h2 className="mb-2 text-sm font-semibold text-telivity-navy">{group.category}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onAdd(item)}
                className="flex min-h-24 flex-col justify-between rounded-xl border border-transparent bg-white p-3 text-left shadow-sm transition-colors hover:border-telivity-teal active:bg-telivity-teal/5"
              >
                <span className="text-sm leading-tight font-semibold text-telivity-navy">{item.name}</span>
                <span className="text-sm text-telivity-slate tabular-nums">{formatPrice(item.price, item.currencyCode)}</span>
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
    <aside className="order-2 flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm lg:min-h-0" aria-label="Cart">
      <h2 className="text-lg font-semibold text-telivity-navy">Order</h2>

      <Field label="Room number *">
        {(id) => (
          <Input
            id={id}
            value={roomNumber}
            onChange={(e) => onRoomNumber(e.target.value)}
            maxLength={20}
            inputMode="text"
            autoComplete="off"
            className="min-h-11 text-lg! font-semibold"
          />
        )}
      </Field>

      <ul className="flex flex-col gap-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {cart.lines.length === 0 && <li className="py-6 text-center text-sm text-telivity-mid-grey">Tap menu items to add them.</li>}
        {cart.lines.map((line) => (
          <li key={line.menuItemId} className="flex flex-col gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-telivity-navy">{line.name}</span>
              <span className="text-sm text-telivity-slate tabular-nums">{formatPrice(line.unitPrice, line.currencyCode)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                aria-label={`One less ${line.name}`}
                disabled={line.quantity <= MIN_QUANTITY}
                onClick={() => dispatchCart({ type: 'setQuantity', menuItemId: line.menuItemId, quantity: line.quantity - 1 })}
                className="min-h-11 min-w-11 px-0!"
              >
                <Minus size={18} aria-hidden="true" />
              </Button>
              <span className="min-w-8 text-center text-lg font-semibold text-telivity-navy tabular-nums" aria-live="polite">
                {line.quantity}
              </span>
              <Button
                variant="secondary"
                aria-label={`One more ${line.name}`}
                disabled={line.quantity >= MAX_QUANTITY}
                onClick={() => dispatchCart({ type: 'setQuantity', menuItemId: line.menuItemId, quantity: line.quantity + 1 })}
                className="min-h-11 min-w-11 px-0!"
              >
                <Plus size={18} aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                onClick={() => dispatchCart({ type: 'remove', menuItemId: line.menuItemId })}
                className="ml-auto min-h-11 text-red-600! hover:bg-red-50!"
              >
                Remove
              </Button>
            </div>
            <Input
              value={line.note}
              onChange={(e) => dispatchCart({ type: 'setNote', menuItemId: line.menuItemId, note: e.target.value })}
              maxLength={500}
              placeholder="Note (e.g. no onions)"
              aria-label={`Note for ${line.name}`}
              className="min-h-11"
            />
          </li>
        ))}
      </ul>

      <Field label="Order notes">
        {(id) => <Textarea id={id} value={orderNotes} onChange={(e) => onOrderNotes(e.target.value)} maxLength={1000} rows={2} />}
      </Field>

      <div className="flex items-baseline justify-between">
        <span className="text-sm text-telivity-slate">Subtotal</span>
        <span className="text-lg font-semibold text-telivity-navy tabular-nums">
          {subtotal.kind === 'ok' && formatMoney(subtotal.minor, subtotal.currencyCode)}
          {subtotal.kind === 'empty' && '—'}
          {subtotal.kind === 'mixed' && <span className="text-telivity-orange">Mixed currencies</span>}
        </span>
      </div>
      <p className="-mt-2 text-xs text-gray-500">Estimate. The server prices the order from the current menu.</p>

      <Button disabled={!canPlace} onClick={onPlaceOrder} className="min-h-12 w-full text-base!">
        {submitting ? 'Placing…' : 'Place order'}
      </Button>
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
      <h2 className="mb-2 text-sm font-semibold text-telivity-navy">Recent orders</h2>
      <Table tableClassName="min-w-[30rem]">
        <TableHead>
          <TableHeader>Status</TableHeader>
          <TableHeader>Room</TableHeader>
          <TableHeader>Order</TableHeader>
          <TableHeader align="right">Total</TableHeader>
          <TableHeader align="right">Placed</TableHeader>
        </TableHead>
        <tbody>
          {orders.length === 0 && <TableEmpty colSpan={5}>No orders yet.</TableEmpty>}
          {orders.map((o) => (
            <TableRow key={o.id}>
              <TableCell>
                <OrderStatusBadge status={o.status} />
              </TableCell>
              <TableCell strong>{o.roomNumber}</TableCell>
              <TableCell className="font-mono text-xs!">{o.orderNumber}</TableCell>
              <TableCell align="right" className="tabular-nums">
                {formatPrice(o.subtotal, o.currencyCode)}
              </TableCell>
              <TableCell align="right" className="tabular-nums">
                {formatAge(o.createdAt, now)}
              </TableCell>
            </TableRow>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
