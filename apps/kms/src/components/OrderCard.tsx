import { memo } from 'react';
import { PRIMARY_ACTION, ageTone, canCancel, minutesSince } from '../kitchen.js';
import { isActiveStatus, type OrderStatus, type OrderWithItems } from '../types.js';

interface Props {
  order: OrderWithItems;
  now: number;
  busy: boolean;
  onChangeStatus: (id: string, status: OrderStatus) => void;
}

const AGE_CLASS = {
  normal: 'bg-neutral-800 text-neutral-200',
  amber: 'bg-amber-500 text-neutral-950',
  red: 'bg-red-600 text-white',
} as const;

const CARD_BORDER = {
  normal: 'border-neutral-700',
  amber: 'border-amber-500',
  red: 'border-red-600',
} as const;

/** Kitchen ticket. Deliberately shows no prices. */
export const OrderCard = memo(function OrderCard({ order, now, busy, onChangeStatus }: Props) {
  if (!isActiveStatus(order.status)) return null;
  const minutes = minutesSince(order.createdAt, now);
  const tone = ageTone(minutes);
  const primary = PRIMARY_ACTION[order.status];

  const cancel = () => {
    if (window.confirm(`Cancel order ${order.orderNumber} for room ${order.roomNumber}?`)) {
      onChangeStatus(order.id, 'cancelled');
    }
  };

  return (
    <article className={`flex flex-col gap-3 rounded-xl border-2 bg-neutral-900 p-4 ${CARD_BORDER[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm uppercase tracking-wide text-neutral-400">Room</div>
          <div className="text-5xl font-black leading-none">{order.roomNumber}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-md px-2 py-1 text-xl font-bold tabular-nums ${AGE_CLASS[tone]}`}>
            {minutes} min
          </span>
          <span className="font-mono text-sm text-neutral-400">{order.orderNumber}</span>
        </div>
      </div>

      <ul className="flex flex-col gap-2 text-xl">
        {order.items.map((item) => (
          <li key={item.id}>
            <span className="font-bold tabular-nums">{item.quantity}×</span> {item.name}
            {item.notes && <div className="pl-8 text-lg italic text-amber-300">{item.notes}</div>}
          </li>
        ))}
      </ul>

      {order.notes && (
        <p className="rounded-md bg-neutral-800 p-2 text-lg text-amber-200">
          <span className="font-semibold">Note:</span> {order.notes}
        </p>
      )}

      <div className="mt-auto flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onChangeStatus(order.id, primary.to)}
          className="min-h-14 flex-1 rounded-lg bg-emerald-600 px-4 text-xl font-bold text-white active:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : primary.label}
        </button>
        {canCancel(order.status) && (
          <button
            type="button"
            disabled={busy}
            onClick={cancel}
            className="min-h-14 min-w-12 rounded-lg bg-neutral-800 px-3 text-lg font-semibold text-red-300 active:bg-neutral-700 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </article>
  );
});
