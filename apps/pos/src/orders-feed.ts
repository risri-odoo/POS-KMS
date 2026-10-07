import type { FeedOrder, Order, OrderWithItems } from './types.js';

export const RECENT_LIMIT = 20;

/**
 * Recent-orders feed: a flat list (finished orders stay visible, unlike the
 * kitchen board). Same ordering safety as the kitchen board: anything with an
 * `updatedAt` older than what we hold is ignored, and a refetch keeps entries
 * that changed while it was in flight (tracked by `seq`).
 */
export interface FeedState {
  seq: number;
  orders: Record<string, { order: FeedOrder; seq: number }>;
}

export type FeedAction =
  /** GET /orders result. `sinceSeq` is the feed seq when the request started. */
  | { type: 'replaceAll'; orders: Order[]; sinceSeq: number }
  /** order.created payload or POST /orders response (with items). */
  | { type: 'upsert'; order: OrderWithItems | Order }
  /** order.status_changed payload (no items). */
  | { type: 'statusChanged'; order: Order };

export const initialFeedState: FeedState = { seq: 0, orders: {} };

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** True when `incoming` is older than `held` (equal timestamps are accepted). */
export function isStale(incomingUpdatedAt: string, heldUpdatedAt: string): boolean {
  return time(incomingUpdatedAt) < time(heldUpdatedAt);
}

/** Merge a record into the held one, keeping items when the incoming row has none. */
function put(orders: FeedState['orders'], incoming: FeedOrder, seq: number): FeedState['orders'] {
  const held = orders[incoming.id];
  if (held && isStale(incoming.updatedAt, held.order.updatedAt)) return orders;
  const items = incoming.items ?? held?.order.items;
  const order: FeedOrder = items ? { ...held?.order, ...incoming, items } : { ...held?.order, ...incoming };
  return { ...orders, [incoming.id]: { order, seq } };
}

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  const seq = state.seq + 1;
  switch (action.type) {
    case 'upsert':
    case 'statusChanged': {
      const orders = put(state.orders, action.order, seq);
      return orders === state.orders ? state : { seq, orders };
    }
    case 'replaceAll': {
      // Keep only what changed while the request was in flight, then apply the result.
      let orders: FeedState['orders'] = {};
      for (const [id, held] of Object.entries(state.orders)) {
        if (held.seq > action.sinceSeq) orders[id] = held;
      }
      for (const order of action.orders) orders = put(orders, order, seq);
      return { seq, orders: keepNewest(orders, RECENT_LIMIT) };
    }
  }
}

/** Bound memory: GET /orders returns the property's whole history. */
function keepNewest(orders: FeedState['orders'], limit: number): FeedState['orders'] {
  const entries = Object.entries(orders);
  if (entries.length <= limit) return orders;
  entries.sort(([, a], [, b]) => compareNewestFirst(a.order, b.order));
  return Object.fromEntries(entries.slice(0, limit));
}

function compareNewestFirst(a: FeedOrder, b: FeedOrder): number {
  return time(b.createdAt) - time(a.createdAt) || b.orderNumber.localeCompare(a.orderNumber);
}

/** The latest orders, newest first, capped at `limit`. */
export function recentOrders(state: FeedState, limit = RECENT_LIMIT): FeedOrder[] {
  return Object.values(state.orders)
    .map((h) => h.order)
    .sort(compareNewestFirst)
    .slice(0, limit);
}
