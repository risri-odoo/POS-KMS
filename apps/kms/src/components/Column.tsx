import { OrderStatusBadge } from '@stayx/ui';
import { COLUMN_TITLES } from '../kitchen.js';
import type { ActiveStatus, OrderStatus, OrderWithItems } from '../types.js';
import { OrderCard } from './OrderCard.js';

interface Props {
  status: ActiveStatus;
  orders: OrderWithItems[];
  now: number;
  inFlight: ReadonlySet<string>;
  onChangeStatus: (id: string, status: OrderStatus) => void;
}

export function Column({ status, orders, now, inFlight, onChangeStatus }: Props) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-xl bg-white/60" aria-label={COLUMN_TITLES[status]}>
      <h2 className="flex items-center justify-between px-3 py-2">
        <OrderStatusBadge status={status} size="lg" highContrast />
        <span className="rounded-full bg-white px-3 py-0.5 text-xl font-semibold text-telivity-navy shadow-sm tabular-nums">{orders.length}</span>
      </h2>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-2">
        {orders.length === 0 && <p className="px-1 py-6 text-center text-lg text-telivity-slate">No orders</p>}
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            now={now}
            busy={inFlight.has(order.id)}
            onChangeStatus={onChangeStatus}
          />
        ))}
      </div>
    </section>
  );
}
