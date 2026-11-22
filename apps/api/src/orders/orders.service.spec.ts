import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { haipPostOutbox, orders } from '@stayx/database';
import { FakeStayLookup } from '../haip/fake-stay-lookup.js';
import { NotConfiguredStayLookup } from '../haip/stay-lookup.js';
import { OrdersService, type Order, type OrderWithItems } from './orders.service.js';
import type { Db } from '../database/database.module.js';
import type { MenuService } from '../menu/menu.service.js';
import type { OrderEventsService } from '../events/order-events.service.js';
import type { HaipQueue } from '../haip/haip-queue.service.js';
import type { CreateOrderDto } from './dto/order.dto.js';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const OUTBOX_ID = '55555555-5555-4555-8555-555555555555';

// A plain object (not a CreateOrderDto instance), so tests can spread it.
const dto = {
  propertyId: PROPERTY_ID,
  roomNumber: '1204',
  items: [{ menuItemId: '44444444-4444-4444-8444-444444444444', quantity: 1 }],
  // Required since Phase 1 step 4; the service is built with the not-configured lookup.
  unverified: true,
} satisfies CreateOrderDto;

const createdOrder = { id: ORDER_ID, propertyId: PROPERTY_ID, status: 'placed', items: [] } as unknown as OrderWithItems;
const updatedRow = { id: ORDER_ID, propertyId: PROPERTY_ID, status: 'accepted' } as unknown as Order;

/** A postgres unique violation on the order-number index, wrapped the way Drizzle wraps it. */
function orderNumberCollision() {
  return Object.assign(new Error('Failed query'), {
    cause: { code: '23505', constraint_name: 'orders_property_order_number_unique' },
  });
}

/** A promise resolved by hand, to check what happens before vs after commit. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * A fake transaction handle for updateStatus: select → current status,
 * update → the new row, insert → the outbox row. Records the insert calls.
 */
function fakeTx(fromStatus: string, toRow: Order) {
  const values = vi.fn();
  const onConflictDoNothing = vi.fn();
  const insert = vi.fn((_table: unknown) => ({
    values: (v: unknown) => {
      values(v);
      return {
        onConflictDoNothing: (opts: unknown) => {
          onConflictDoNothing(opts);
          return { returning: () => Promise.resolve([{ id: OUTBOX_ID }]) };
        },
      };
    },
  }));
  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ status: fromStatus }]) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([toRow]) }) }) }),
    insert,
  };
  return { tx, insert, values, onConflictDoNothing };
}

describe('OrdersService', () => {
  let db: { transaction: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };
  let events: { emitOrderCreated: ReturnType<typeof vi.fn>; emitOrderStatusChanged: ReturnType<typeof vi.fn> };
  let queue: { enqueue: ReturnType<typeof vi.fn> };
  let service: OrdersService;

  beforeEach(() => {
    // db.insert must never be used directly by updateStatus: only tx.insert.
    db = { transaction: vi.fn(), insert: vi.fn() };
    events = { emitOrderCreated: vi.fn(), emitOrderStatusChanged: vi.fn() };
    queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    service = new OrdersService(
      db as unknown as Db,
      {} as MenuService,
      events as unknown as OrderEventsService,
      queue as unknown as HaipQueue,
      new NotConfiguredStayLookup(),
    );
  });

  describe('create: stay binding', () => {
    const menu = { findByIds: vi.fn().mockResolvedValue([
      { id: dto.items[0]!.menuItemId, propertyId: PROPERTY_ID, name: 'Tea', price: '5.00', currencyCode: 'USD', isAvailable: true },
    ]) };

    /** Runs the real transaction callback against a fake tx and records what is inserted into orders. */
    function capturingDb() {
      const inserted: Record<string, unknown>[] = [];
      const tx = {
        insert: (table: unknown) => ({
          values: (v: Record<string, unknown> | Record<string, unknown>[]) => ({
            returning: () => {
              if (table === orders) {
                inserted.push(v as Record<string, unknown>);
                return Promise.resolve([{ id: ORDER_ID, ...(v as Record<string, unknown>) }]);
              }
              return Promise.resolve([]);
            },
          }),
        }),
      };
      const capture = { transaction: vi.fn((cb: (t: unknown) => unknown) => cb(tx)), insert: vi.fn() };
      return { capture, inserted };
    }

    it('writes the confirmed stay, folio and guest name onto the order', async () => {
      const lookup = new FakeStayLookup([
        {
          propertyId: PROPERTY_ID,
          reservationId: '66666666-6666-4666-8666-666666666666',
          status: 'checked_in',
          roomNumber: '1204',
          departureDate: '2026-12-01',
          guestFolioId: '77777777-7777-4777-8777-777777777777',
          occupants: [{ firstName: 'Ada', lastInitial: 'L' }],
        },
      ]);
      const { capture, inserted } = capturingDb();
      const svc = new OrdersService(capture as unknown as Db, menu as unknown as MenuService, events as unknown as OrderEventsService, queue as unknown as HaipQueue, lookup);

      await svc.create({ ...dto, unverified: undefined, reservationId: '66666666-6666-4666-8666-666666666666', confirmedGuestName: 'Ada L.' });

      expect(inserted[0]).toMatchObject({
        roomNumber: '1204',
        haipReservationId: '66666666-6666-4666-8666-666666666666',
        haipFolioId: '77777777-7777-4777-8777-777777777777',
        verificationStatus: 'verified',
        verifiedGuestName: 'Ada L.',
      });
      expect(inserted[0]!['verifiedAt']).toBeInstanceOf(Date);
    });

    it('writes an unverified order with no stay ids', async () => {
      const { capture, inserted } = capturingDb();
      const svc = new OrdersService(capture as unknown as Db, menu as unknown as MenuService, events as unknown as OrderEventsService, queue as unknown as HaipQueue, new NotConfiguredStayLookup());

      await svc.create(dto);

      expect(inserted[0]).toMatchObject({ verificationStatus: 'unverified', haipReservationId: null, haipFolioId: null, verifiedGuestName: null });
    });

    it('a rejected binding writes nothing and emits nothing', async () => {
      await expect(service.create({ ...dto, unverified: undefined })).rejects.toBeInstanceOf(BadRequestException);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(events.emitOrderCreated).not.toHaveBeenCalled();
    });
  });

  describe('create: event emission', () => {
    it('emits nothing when the transaction rejects', async () => {
      db.transaction.mockRejectedValue(new Error('db down'));

      await expect(service.create(dto)).rejects.toThrow('db down');
      expect(events.emitOrderCreated).not.toHaveBeenCalled();
      expect(events.emitOrderStatusChanged).not.toHaveBeenCalled();
    });

    it('emits order.created exactly once, only after the transaction resolves', async () => {
      const tx = deferred<OrderWithItems>();
      db.transaction.mockReturnValue(tx.promise);

      const pending = service.create(dto);
      await Promise.resolve();
      expect(events.emitOrderCreated).not.toHaveBeenCalled(); // not committed yet

      tx.resolve(createdOrder);
      await expect(pending).resolves.toBe(createdOrder);
      expect(events.emitOrderCreated).toHaveBeenCalledExactlyOnceWith(createdOrder);
    });

    it('emits once after an order-number collision retry, nothing for the rolled-back attempt', async () => {
      db.transaction.mockRejectedValueOnce(orderNumberCollision()).mockResolvedValueOnce(createdOrder);

      await service.create(dto);

      expect(db.transaction).toHaveBeenCalledTimes(2);
      expect(events.emitOrderCreated).toHaveBeenCalledExactlyOnceWith(createdOrder);
    });

    it('emits nothing when every retry collides', async () => {
      db.transaction.mockImplementation(() => Promise.reject(orderNumberCollision()));

      await expect(service.create(dto)).rejects.toThrow('Failed query');
      expect(db.transaction).toHaveBeenCalledTimes(3);
      expect(events.emitOrderCreated).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus: events and HAIP outbox', () => {
    it('emits nothing and enqueues nothing when the transaction rejects (e.g. a 409)', async () => {
      db.transaction.mockRejectedValue(new ConflictException('modified concurrently'));

      await expect(service.updateStatus(ORDER_ID, PROPERTY_ID, 'delivered')).rejects.toThrow(ConflictException);
      expect(events.emitOrderStatusChanged).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('emits order.status_changed exactly once, only after the transaction resolves', async () => {
      const tx = deferred<{ row: Order; outboxId?: string }>();
      db.transaction.mockReturnValue(tx.promise);

      const pending = service.updateStatus(ORDER_ID, PROPERTY_ID, 'accepted');
      await Promise.resolve();
      expect(events.emitOrderStatusChanged).not.toHaveBeenCalled();

      tx.resolve({ row: updatedRow });
      await expect(pending).resolves.toBe(updatedRow);
      expect(events.emitOrderStatusChanged).toHaveBeenCalledExactlyOnceWith(updatedRow);
      expect(events.emitOrderCreated).not.toHaveBeenCalled();
    });

    it('delivered: inserts the outbox row inside the SAME transaction callback, then enqueues after commit', async () => {
      const delivered = { ...updatedRow, status: 'delivered' } as Order;
      const fake = fakeTx('ready', delivered);
      let insertsWhenCallbackFinished = -1;
      db.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        const result = await cb(fake.tx);
        insertsWhenCallbackFinished = fake.insert.mock.calls.length;
        // Nothing may be queued before the transaction has committed.
        expect(queue.enqueue).not.toHaveBeenCalled();
        return result;
      });

      await expect(service.updateStatus(ORDER_ID, PROPERTY_ID, 'delivered')).resolves.toBe(delivered);

      expect(insertsWhenCallbackFinished).toBe(1);
      expect(fake.insert).toHaveBeenCalledWith(haipPostOutbox);
      expect(db.insert).not.toHaveBeenCalled();
      expect(fake.values).toHaveBeenCalledWith({
        propertyId: PROPERTY_ID,
        orderId: ORDER_ID,
        vendorTxnId: `stayx-rs-${ORDER_ID}`,
      });
      expect(fake.onConflictDoNothing).toHaveBeenCalledWith({
        target: [haipPostOutbox.propertyId, haipPostOutbox.vendorTxnId],
      });
      expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith(OUTBOX_ID);
      expect(events.emitOrderStatusChanged).toHaveBeenCalledExactlyOnceWith(delivered);
    });

    it.each([
      ['placed', 'accepted'],
      ['accepted', 'preparing'],
      ['preparing', 'ready'],
      ['placed', 'cancelled'],
    ] as const)('%s → %s inserts no outbox row and enqueues nothing', async (from, status) => {
      const fake = fakeTx(from, { ...updatedRow, status } as Order);
      db.transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(fake.tx));

      await service.updateStatus(ORDER_ID, PROPERTY_ID, status);

      expect(fake.insert).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('a failing enqueue does not fail the request (the sweeper recovers it)', async () => {
      const delivered = { ...updatedRow, status: 'delivered' } as Order;
      const fake = fakeTx('ready', delivered);
      db.transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(fake.tx));
      queue.enqueue.mockRejectedValue(new Error('redis down'));

      await expect(service.updateStatus(ORDER_ID, PROPERTY_ID, 'delivered')).resolves.toBe(delivered);
      expect(events.emitOrderStatusChanged).toHaveBeenCalledOnce();
    });
  });
});
