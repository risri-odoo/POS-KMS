import { describe, it, expect } from 'vitest';
import { feedReducer, initialFeedState, recentOrders, RECENT_LIMIT, type FeedAction, type FeedState } from './orders-feed.js';
import type { Order, OrderStatus, OrderWithItems } from './types.js';

function order(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id,
    propertyId: 'p',
    orderNumber: `RS-261007-${id.toUpperCase().padStart(4, '0')}`,
    roomNumber: '101',
    status: 'placed',
    subtotal: '10.00',
    currencyCode: 'USD',
    notes: null,
    placedBy: 'pos',
    deliveredAt: null,
    cancelledAt: null,
    createdAt: '2026-10-07T10:00:00.000Z',
    updatedAt: '2026-10-07T10:00:00.000Z',
    ...overrides,
  };
}

function withItems(o: Order): OrderWithItems {
  return {
    ...o,
    items: [
      {
        id: `${o.id}-1`,
        propertyId: 'p',
        orderId: o.id,
        menuItemId: null,
        name: 'Soda',
        unitPrice: '10.00',
        quantity: 1,
        lineTotal: '10.00',
        notes: null,
        createdAt: o.createdAt,
      },
    ],
  };
}

const at = (minute: number) => `2026-10-07T10:${String(minute).padStart(2, '0')}:00.000Z`;
const change = (o: Order, status: OrderStatus, minute: number): Order => ({ ...o, status, updatedAt: at(minute) });

function run(...actions: FeedAction[]): FeedState {
  return actions.reduce(feedReducer, initialFeedState);
}

describe('feedReducer', () => {
  it('a status change merges into the held order and keeps its items', () => {
    const a = order('a');
    const state = run({ type: 'upsert', order: withItems(a) }, { type: 'statusChanged', order: change(a, 'accepted', 1) });
    const held = recentOrders(state)[0]!;
    expect(held.status).toBe('accepted');
    expect(held.items).toHaveLength(1);
  });

  it('ignores an event older than what is held', () => {
    const a = order('a');
    const state = run(
      { type: 'upsert', order: a },
      { type: 'statusChanged', order: change(a, 'ready', 5) },
      { type: 'statusChanged', order: change(a, 'accepted', 2) },
    );
    expect(recentOrders(state)[0]!.status).toBe('ready');
  });

  it('keeps finished orders in the feed (unlike the kitchen board)', () => {
    const a = order('a');
    const state = run({ type: 'upsert', order: a }, { type: 'statusChanged', order: change(a, 'delivered', 9) });
    expect(recentOrders(state).map((o) => o.status)).toEqual(['delivered']);
  });

  it('adds an unknown order from a status change (the list shows no items)', () => {
    const state = run({ type: 'statusChanged', order: change(order('x'), 'preparing', 3) });
    expect(recentOrders(state).map((o) => o.id)).toEqual(['x']);
  });

  it('replaceAll keeps a newer event that arrived while the request was in flight', () => {
    const a = order('a');
    const start = run({ type: 'upsert', order: a });
    const sinceSeq = start.seq;
    const during = feedReducer(start, { type: 'statusChanged', order: change(a, 'preparing', 4) });
    const state = feedReducer(during, { type: 'replaceAll', orders: [change(a, 'accepted', 2)], sinceSeq });
    expect(recentOrders(state)[0]!.status).toBe('preparing');
  });

  it('replaceAll drops entries that were held before the request started', () => {
    const start = run({ type: 'upsert', order: order('old') });
    const state = feedReducer(start, { type: 'replaceAll', orders: [order('b')], sinceSeq: start.seq });
    expect(recentOrders(state).map((o) => o.id)).toEqual(['b']);
  });
});

describe('recentOrders', () => {
  it('sorts newest first by createdAt', () => {
    const state = run(
      { type: 'upsert', order: order('b', { createdAt: at(5), updatedAt: at(5) }) },
      { type: 'upsert', order: order('c', { createdAt: at(9), updatedAt: at(9) }) },
      { type: 'upsert', order: order('a', { createdAt: at(1), updatedAt: at(1) }) },
    );
    expect(recentOrders(state).map((o) => o.id)).toEqual(['c', 'b', 'a']);
  });

  it(`caps the list at ${RECENT_LIMIT}`, () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      order(`o${i}`, { createdAt: at(i), updatedAt: at(i) }),
    );
    const state = run({ type: 'replaceAll', orders: many, sinceSeq: 0 });
    const recent = recentOrders(state);
    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(recent[0]!.id).toBe('o29');
    expect(recent.at(-1)!.id).toBe('o10');
  });
});
