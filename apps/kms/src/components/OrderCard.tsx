import { memo, useState } from 'react';
import { Button, ConfirmModal } from '@stayx/ui';
import { PRIMARY_ACTION, ageTone, canCancel, minutesSince } from '../kitchen.js';
import { isActiveStatus, type OrderStatus, type OrderWithItems } from '../types.js';

interface Props {
  order: OrderWithItems;
  now: number;
  busy: boolean;
  onChangeStatus: (id: string, status: OrderStatus) => void;
}

const AGE_CLASS = {
  normal: 'bg-gray-100 text-telivity-navy',
  amber: 'bg-telivity-orange text-telivity-navy',
  red: 'bg-red-600 text-white',
} as const;

const CARD_BORDER = {
  normal: 'border-gray-200',
  amber: 'border-telivity-orange',
  red: 'border-red-600',
} as const;

/** Kitchen ticket. Deliberately shows no prices. */
export const OrderCard = memo(function OrderCard({ order, now, busy, onChangeStatus }: Props) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  if (!isActiveStatus(order.status)) return null;
  const minutes = minutesSince(order.createdAt, now);
  const tone = ageTone(minutes);
  const primary = PRIMARY_ACTION[order.status];

  const cancel = () => {
    setConfirmingCancel(false);
    onChangeStatus(order.id, 'cancelled');
  };

  return (
    <article className={`flex flex-col gap-3 rounded-xl border-2 bg-white p-3 text-telivity-navy shadow-sm ${CARD_BORDER[tone]}`}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm tracking-wide text-telivity-slate uppercase">Room</span>
          <span className={`flex-shrink-0 rounded-md px-2 py-0.5 text-xl font-semibold tabular-nums ${AGE_CLASS[tone]}`}>{minutes} min</span>
        </div>
        {/* Own line, so a normal room number never wraps. Only very long ones break. */}
        <div className="mt-1 text-5xl leading-none font-semibold break-all">{order.roomNumber}</div>
        <div className="mt-1 font-mono text-sm text-telivity-slate">{order.orderNumber}</div>
      </div>

      <ul className="flex flex-col gap-2 text-xl">
        {order.items.map((item) => (
          <li key={item.id}>
            <span className="font-semibold tabular-nums">{item.quantity}×</span> {item.name}
            {item.notes && <div className="mt-1 rounded-md bg-telivity-yellow/25 px-2 py-1 text-lg italic">{item.notes}</div>}
          </li>
        ))}
      </ul>

      {order.notes && (
        <p className="rounded-md bg-telivity-yellow/25 p-2 text-lg">
          <span className="font-semibold">Note:</span> {order.notes}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-2 xl:flex-row">
        <Button size="touch" highContrast disabled={busy} onClick={() => onChangeStatus(order.id, primary.to)} className="px-2! xl:flex-1">
          {busy ? 'Saving…' : primary.label}
        </Button>
        {canCancel(order.status) && (
          <Button size="touch" variant="secondary" disabled={busy} onClick={() => setConfirmingCancel(true)} className="min-h-12! px-3! text-red-600! xl:min-h-14!">
            Cancel
          </Button>
        )}
      </div>

      <ConfirmModal
        open={confirmingCancel && canCancel(order.status)}
        title="Cancel order?"
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        danger
        touch
        onConfirm={cancel}
        onCancel={() => setConfirmingCancel(false)}
      >
        Cancel order {order.orderNumber} for room {order.roomNumber}?
      </ConfirmModal>
    </article>
  );
});
