import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { OrdersService, type Order, type OrderWithItems } from './orders.service.js';
import type { Db } from '../database/database.module.js';
import type { MenuService } from '../menu/menu.service.js';
import type { OrderEventsService } from '../events/order-events.service.js';
import type { CreateOrderDto } from './dto/order.dto.js';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';

const dto: CreateOrderDto = {
  propertyId: PROPERTY_ID,
  roomNumber: '1204',
  items: [{ menuItemId: '44444444-4444-4444-8444-444444444444', quantity: 1 }],
};

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

describe('OrdersService event emission', () => {
  let db: { transaction: ReturnType<typeof vi.fn> };
  let events: { emitOrderCreated: ReturnType<typeof vi.fn>; emitOrderStatusChanged: ReturnType<typeof vi.fn> };
  let service: OrdersService;

  beforeEach(() => {
    db = { transaction: vi.fn() };
    events = { emitOrderCreated: vi.fn(), emitOrderStatusChanged: vi.fn() };
    service = new OrdersService(db as unknown as Db, {} as MenuService, events as unknown as OrderEventsService);
  });

  describe('create', () => {
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

  describe('updateStatus', () => {
    it('emits nothing when the transaction rejects (e.g. a 409)', async () => {
      db.transaction.mockRejectedValue(new ConflictException('modified concurrently'));

      await expect(service.updateStatus(ORDER_ID, PROPERTY_ID, 'accepted')).rejects.toThrow(ConflictException);
      expect(events.emitOrderStatusChanged).not.toHaveBeenCalled();
    });

    it('emits order.status_changed exactly once, only after the transaction resolves', async () => {
      const tx = deferred<Order>();
      db.transaction.mockReturnValue(tx.promise);

      const pending = service.updateStatus(ORDER_ID, PROPERTY_ID, 'accepted');
      await Promise.resolve();
      expect(events.emitOrderStatusChanged).not.toHaveBeenCalled();

      tx.resolve(updatedRow);
      await expect(pending).resolves.toBe(updatedRow);
      expect(events.emitOrderStatusChanged).toHaveBeenCalledExactlyOnceWith(updatedRow);
      expect(events.emitOrderCreated).not.toHaveBeenCalled();
    });
  });
});
