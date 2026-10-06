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
    <section className="flex min-h-0 min-w-72 flex-col rounded-xl bg-neutral-900/50" aria-label={COLUMN_TITLES[status]}>
      <h2 className="flex items-center justify-between px-4 py-3 text-2xl font-bold">
        {COLUMN_TITLES[status]}
        <span className="rounded-full bg-neutral-800 px-3 py-0.5 text-xl tabular-nums">{orders.length}</span>
      </h2>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
        {orders.length === 0 && <p className="px-1 py-6 text-center text-lg text-neutral-600">No orders</p>}
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
