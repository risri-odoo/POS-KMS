import { orderStatus } from '@stayx/database';

export type OrderStatus = (typeof orderStatus.enumValues)[number];

/**
 * Room-service order lifecycle. Forward-only; `delivered` and `cancelled` are
 * final. Cancellation is allowed up to (but not after) `ready`.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  placed: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['delivered'],
  delivered: [],
  cancelled: [],
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && Object.hasOwn(TRANSITIONS, value);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isFinalStatus(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
