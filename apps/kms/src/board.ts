import { ACTIVE_STATUSES, isActiveStatus, type ActiveStatus, type Order, type OrderWithItems } from './types.js';

/**
 * Kitchen board state. Pure: no fetching, no sockets, no clock.
 *
 * Ordering safety: socket events can overtake each other, and a full refetch
 * can overlap live events. Every incoming record is compared by `updatedAt`
 * and anything older than what we already know is ignored. Removed orders
 * leave a tombstone so a stale record can't resurrect them.
 *
 * `seq` counts processed actions. Each held order and tombstone remembers the
 * seq at which it was last touched, so `replaceAll` can tell "arrived while the
 * refetch was in flight" (keep) from "was here before the refetch began" (the
 * refetch result is authoritative).
 */
export interface BoardState {
  seq: number;
  orders: Record<string, HeldOrder>;
  tombstones: Record<string, Tombstone>;
}

export interface HeldOrder {
  order: OrderWithItems;
  seq: number;
}

interface Tombstone {
  updatedAt: string;
  seq: number;
}

export type BoardAction =
  /** A full refetch result. `sinceSeq` is the board seq when the refetch started. */
  | { type: 'replaceAll'; orders: OrderWithItems[]; sinceSeq: number }
  /** A complete order with items (order.created, or a single GET /orders/:id). */
  | { type: 'upsert'; order: OrderWithItems }
  /** An order.status_changed row (no items) or a PATCH response. */
  | { type: 'statusChanged'; order: Order }
  | { type: 'remove'; id: string; updatedAt: string };

export const initialBoardState: BoardState = { seq: 0, orders: {}, tombstones: {} };

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** True when `incoming` is older than `held` (equal timestamps are accepted). */
export function isStale(incomingUpdatedAt: string, heldUpdatedAt: string): boolean {
  return time(incomingUpdatedAt) < time(heldUpdatedAt);
}

/** Is `updatedAt` for `id` already superseded by what the board holds or has removed? */
function superseded(state: BoardState, id: string, updatedAt: string): boolean {
  const held = state.orders[id];
  if (held && isStale(updatedAt, held.order.updatedAt)) return true;
  const tomb = state.tombstones[id];
  if (tomb && !isStale(tomb.updatedAt, updatedAt)) return true; // removal is same age or newer
  return false;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return rest;
}

/** Apply a complete order: hold it if active, tombstone it if finished. */
function put(state: BoardState, order: OrderWithItems, seq: number): BoardState {
  if (superseded(state, order.id, order.updatedAt)) return state;

  if (!isActiveStatus(order.status)) {
    return {
      ...state,
      orders: withoutKey(state.orders, order.id),
      tombstones: { ...state.tombstones, [order.id]: { updatedAt: order.updatedAt, seq } },
    };
  }
  return {
    ...state,
    orders: { ...state.orders, [order.id]: { order, seq } },
    tombstones: withoutKey(state.tombstones, order.id),
  };
}

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  const seq = state.seq + 1;
  const next = reduce(state, action, seq);
  return next === state ? state : { ...next, seq };
}

function reduce(state: BoardState, action: BoardAction, seq: number): BoardState {
  switch (action.type) {
    case 'upsert':
      return put(state, action.order, seq);

    case 'statusChanged': {
      const held = state.orders[action.order.id];
      // Unknown order: nothing to merge items into. The caller fetches it
      // (see needsFetch). A finished unknown order only leaves a tombstone.
      if (!held) {
        if (isActiveStatus(action.order.status)) return state;
        if (superseded(state, action.order.id, action.order.updatedAt)) return state;
        return {
          ...state,
          tombstones: { ...state.tombstones, [action.order.id]: { updatedAt: action.order.updatedAt, seq } },
        };
      }
      // The row carries no items: keep the ones we already hold.
      return put(state, { ...held.order, ...action.order, items: held.order.items }, seq);
    }

    case 'remove': {
      if (superseded(state, action.id, action.updatedAt)) return state;
      return {
        ...state,
        orders: withoutKey(state.orders, action.id),
        tombstones: { ...state.tombstones, [action.id]: { updatedAt: action.updatedAt, seq } },
      };
    }

    case 'replaceAll': {
      // Start from what changed while the refetch was in flight; it may be newer.
      const orders: Record<string, HeldOrder> = {};
      for (const [id, held] of Object.entries(state.orders)) {
        if (held.seq > action.sinceSeq) orders[id] = held;
      }
      const tombstones: Record<string, Tombstone> = {};
      for (const [id, tomb] of Object.entries(state.tombstones)) {
        if (tomb.seq > action.sinceSeq) tombstones[id] = tomb;
      }
      let next: BoardState = { ...state, orders, tombstones };
      for (const order of action.orders) next = put(next, order, seq);
      return next;
    }
  }
}

/**
 * Should a status-change row trigger GET /orders/:id? Yes when the board
 * doesn't hold the order (a missed order.created), it is still active, and it
 * isn't superseded by a newer removal.
 */
export function needsFetch(state: BoardState, order: Order): boolean {
  return !state.orders[order.id] && isActiveStatus(order.status) && !superseded(state, order.id, order.updatedAt);
}

export type BoardColumns = Record<ActiveStatus, OrderWithItems[]>;

/** Group held orders into the four columns, oldest first (FIFO) in each. */
export function groupColumns(state: BoardState): BoardColumns {
  const columns: BoardColumns = { placed: [], accepted: [], preparing: [], ready: [] };
  for (const { order } of Object.values(state.orders)) {
    if (isActiveStatus(order.status)) columns[order.status].push(order);
  }
  for (const status of ACTIVE_STATUSES) {
    columns[status].sort(
      (a, b) => time(a.createdAt) - time(b.createdAt) || a.orderNumber.localeCompare(b.orderNumber),
    );
  }
  return columns;
}
