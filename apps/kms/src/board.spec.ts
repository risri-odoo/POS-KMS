import { describe, it, expect } from 'vitest';
import { boardReducer, groupColumns, initialBoardState, needsFetch, type BoardAction, type BoardState } from './board.js';
import type { Order, OrderStatus, OrderWithItems } from './types.js';

const PROPERTY = '11111111-1111-4111-8111-111111111111';

function order(id: string, overrides: Partial<OrderWithItems> = {}): OrderWithItems {
  return {
    id,
    propertyId: PROPERTY,
    orderNumber: `RS-261006-${id.toUpperCase()}`,
    roomNumber: '101',
    status: 'placed',
    subtotal: '10.00',
    currencyCode: 'USD',
    notes: null,
    placedBy: null,
    deliveredAt: null,
    cancelledAt: null,
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:00.000Z',
    items: [
      {
        id: `${id}-item`,
        propertyId: PROPERTY,
        orderId: id,
        menuItemId: null,
        name: 'Club Sandwich',
        unitPrice: '10.00',
        quantity: 1,
        lineTotal: '10.00',
        notes: 'No onions',
        createdAt: '2026-10-06T10:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

/** An order.status_changed payload: the row without items. */
function row(o: OrderWithItems, status: OrderStatus, updatedAt: string): Order {
  const { items: _items, ...rest } = o;
  return { ...rest, status, updatedAt };
}

function run(...actions: BoardAction[]): BoardState {
  return actions.reduce(boardReducer, initialBoardState);
}

describe('boardReducer', () => {
  it('upsert adds an order with its items', () => {
    const state = run({ type: 'upsert', order: order('a') });
    expect(state.orders['a']?.order.items).toHaveLength(1);
  });

  it('merge-status-change keeps the items held from the create', () => {
    const a = order('a');
    const state = run(
      { type: 'upsert', order: a },
      { type: 'statusChanged', order: row(a, 'accepted', '2026-10-06T10:01:00.000Z') },
    );
    const held = state.orders['a']!.order;
    expect(held.status).toBe('accepted');
    expect(held.updatedAt).toBe('2026-10-06T10:01:00.000Z');
    expect(held.items).toEqual(a.items);
  });

  it('ignores a stale status change that arrives after a newer one', () => {
    const a = order('a');
    const state = run(
      { type: 'upsert', order: a },
      { type: 'statusChanged', order: row(a, 'preparing', '2026-10-06T10:02:00.000Z') },
      { type: 'statusChanged', order: row(a, 'accepted', '2026-10-06T10:01:00.000Z') },
    );
    expect(state.orders['a']!.order.status).toBe('preparing');
  });

  it('ignores a stale upsert (e.g. an older full record)', () => {
    const a = order('a', { status: 'ready', updatedAt: '2026-10-06T10:05:00.000Z' });
    const state = run({ type: 'upsert', order: a }, { type: 'upsert', order: order('a') });
    expect(state.orders['a']!.order.status).toBe('ready');
  });

  it.each<OrderStatus>(['delivered', 'cancelled'])('removes an order that becomes %s', (status) => {
    const a = order('a', { status: 'ready' });
    const state = run(
      { type: 'upsert', order: a },
      { type: 'statusChanged', order: row(a, status, '2026-10-06T10:10:00.000Z') },
    );
    expect(state.orders['a']).toBeUndefined();
    expect(groupColumns(state).ready).toHaveLength(0);
  });

  it('does not resurrect a removed order from a stale event', () => {
    const a = order('a', { status: 'ready' });
    const state = run(
      { type: 'upsert', order: a },
      { type: 'statusChanged', order: row(a, 'delivered', '2026-10-06T10:10:00.000Z') },
      { type: 'statusChanged', order: row(a, 'ready', '2026-10-06T10:05:00.000Z') },
      { type: 'upsert', order: { ...a, updatedAt: '2026-10-06T10:05:00.000Z' } },
    );
    expect(state.orders['a']).toBeUndefined();
  });

  it('remove action drops the order', () => {
    const state = run({ type: 'upsert', order: order('a') }, { type: 'remove', id: 'a', updatedAt: '2026-10-06T10:01:00.000Z' });
    expect(state.orders['a']).toBeUndefined();
  });

  it('does not add a delivered order from upsert', () => {
    const state = run({ type: 'upsert', order: order('a', { status: 'delivered' }) });
    expect(state.orders['a']).toBeUndefined();
  });

  describe('unknown orders', () => {
    it('an active status change for an unknown order changes nothing and needs a fetch', () => {
      const a = order('a');
      const change = row(a, 'accepted', '2026-10-06T10:01:00.000Z');
      const state = run({ type: 'statusChanged', order: change });
      expect(state.orders['a']).toBeUndefined();
      expect(needsFetch(state, change)).toBe(true);
    });

    it('a finished status change for an unknown order needs no fetch', () => {
      const change = row(order('a'), 'delivered', '2026-10-06T10:01:00.000Z');
      expect(needsFetch(initialBoardState, change)).toBe(false);
      expect(run({ type: 'statusChanged', order: change }).orders['a']).toBeUndefined();
    });

    it('a known order needs no fetch', () => {
      const a = order('a');
      const state = run({ type: 'upsert', order: a });
      expect(needsFetch(state, row(a, 'accepted', '2026-10-06T10:01:00.000Z'))).toBe(false);
    });

    it('an unknown order already removed with a newer timestamp needs no fetch', () => {
      const a = order('a');
      const state = run({ type: 'statusChanged', order: row(a, 'cancelled', '2026-10-06T10:05:00.000Z') });
      expect(needsFetch(state, row(a, 'accepted', '2026-10-06T10:01:00.000Z'))).toBe(false);
    });
  });

  describe('replaceAll', () => {
    it('replaces orders that were held before the refetch started', () => {
      const before = run({ type: 'upsert', order: order('old') });
      const state = boardReducer(before, { type: 'replaceAll', orders: [order('b')], sinceSeq: before.seq });
      expect(Object.keys(state.orders)).toEqual(['b']);
    });

    it('keeps an order created by an event while the refetch was in flight', () => {
      const sinceSeq = initialBoardState.seq;
      const during = run({ type: 'upsert', order: order('live') });
      const state = boardReducer(during, { type: 'replaceAll', orders: [order('b')], sinceSeq });
      expect(Object.keys(state.orders).sort()).toEqual(['b', 'live']);
    });

    it('keeps a newer event over an older record in the refetch result', () => {
      const a = order('a');
      const start = run({ type: 'upsert', order: a });
      const sinceSeq = start.seq;
      const during = boardReducer(start, { type: 'statusChanged', order: row(a, 'preparing', '2026-10-06T10:03:00.000Z') });
      const state = boardReducer(during, {
        type: 'replaceAll',
        orders: [{ ...a, status: 'accepted', updatedAt: '2026-10-06T10:01:00.000Z' }],
        sinceSeq,
      });
      expect(state.orders['a']!.order.status).toBe('preparing');
    });

    it('does not re-add an order removed while the refetch was in flight', () => {
      const a = order('a', { status: 'ready' });
      const start = run({ type: 'upsert', order: a });
      const sinceSeq = start.seq;
      const during = boardReducer(start, { type: 'statusChanged', order: row(a, 'delivered', '2026-10-06T10:10:00.000Z') });
      const state = boardReducer(during, { type: 'replaceAll', orders: [a], sinceSeq });
      expect(state.orders['a']).toBeUndefined();
    });
  });
});

describe('groupColumns', () => {
  it('groups into the four columns, oldest first (FIFO) in each', () => {
    const state = run(
      { type: 'upsert', order: order('late', { createdAt: '2026-10-06T10:20:00.000Z' }) },
      { type: 'upsert', order: order('early', { createdAt: '2026-10-06T10:00:00.000Z' }) },
      { type: 'upsert', order: order('mid', { createdAt: '2026-10-06T10:10:00.000Z' }) },
      { type: 'upsert', order: order('cook', { status: 'preparing' }) },
      { type: 'upsert', order: order('done', { status: 'ready' }) },
    );
    const columns = groupColumns(state);

    expect(columns.placed.map((o) => o.id)).toEqual(['early', 'mid', 'late']);
    expect(columns.accepted).toEqual([]);
    expect(columns.preparing.map((o) => o.id)).toEqual(['cook']);
    expect(columns.ready.map((o) => o.id)).toEqual(['done']);
  });

  it('sorts by created time, not by when the status last changed', () => {
    const first = order('first', { createdAt: '2026-10-06T10:00:00.000Z' });
    const second = order('second', { createdAt: '2026-10-06T10:05:00.000Z' });
    const state = run(
      { type: 'upsert', order: second },
      { type: 'upsert', order: first },
      { type: 'statusChanged', order: row(second, 'accepted', '2026-10-06T10:06:00.000Z') },
      { type: 'statusChanged', order: row(first, 'accepted', '2026-10-06T10:30:00.000Z') },
    );
    expect(groupColumns(state).accepted.map((o) => o.id)).toEqual(['first', 'second']);
  });
});
