import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { OrderEventsService, ORDER_CREATED, ORDER_STATUS_CHANGED } from './order-events.service.js';
import type { KitchenGateway } from './kitchen.gateway.js';
import type { Order, OrderWithItems } from '../orders/orders.service.js';

const PROPERTY_A = '11111111-1111-4111-8111-111111111111';
const PROPERTY_B = '22222222-2222-4222-8222-222222222222';

const order = {
  id: 'order-1',
  propertyId: PROPERTY_A,
  orderNumber: 'RS-261006-AB12',
  roomNumber: '1204',
  status: 'placed',
  subtotal: '34.75',
  currencyCode: 'USD',
} as unknown as Order;

const orderWithItems = {
  ...order,
  items: [{ id: 'item-1', name: 'Club Sandwich', quantity: 2 }],
} as unknown as OrderWithItems;

describe('OrderEventsService', () => {
  let emit: ReturnType<typeof vi.fn>;
  let to: ReturnType<typeof vi.fn>;
  let server: { to: typeof to; emit: ReturnType<typeof vi.fn> };
  let service: OrderEventsService;

  beforeEach(() => {
    emit = vi.fn();
    to = vi.fn(() => ({ emit }));
    // server.emit would broadcast to every socket; it must never be used.
    server = { to, emit: vi.fn() };
    service = new OrderEventsService({ server } as unknown as KitchenGateway);
  });

  it('emits order.created with the full order (items included) to the property room', () => {
    service.emitOrderCreated(orderWithItems);

    expect(ORDER_CREATED).toBe('order.created');
    expect(to).toHaveBeenCalledExactlyOnceWith(`property:${PROPERTY_A}`);
    expect(emit).toHaveBeenCalledExactlyOnceWith('order.created', orderWithItems);
  });

  it('emits order.status_changed with the order row to the property room', () => {
    const updated = { ...order, status: 'accepted' } as Order;
    service.emitOrderStatusChanged(updated);

    expect(ORDER_STATUS_CHANGED).toBe('order.status_changed');
    expect(to).toHaveBeenCalledExactlyOnceWith(`property:${PROPERTY_A}`);
    expect(emit).toHaveBeenCalledExactlyOnceWith('order.status_changed', updated);
  });

  it("only targets the order's own property room and never broadcasts globally", () => {
    service.emitOrderCreated({ ...orderWithItems, propertyId: PROPERTY_B });

    expect(to).toHaveBeenCalledExactlyOnceWith(`property:${PROPERTY_B}`);
    expect(to).not.toHaveBeenCalledWith(`property:${PROPERTY_A}`);
    expect(server.emit).not.toHaveBeenCalled();
  });

  it('swallows and logs errors thrown by the socket server', () => {
    const logSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    to.mockImplementation(() => {
      throw new Error('socket server exploded');
    });

    expect(() => service.emitOrderCreated(orderWithItems)).not.toThrow();
    expect(() => service.emitOrderStatusChanged(order)).not.toThrow();
    expect(logSpy).toHaveBeenCalledTimes(2);
    logSpy.mockRestore();
  });

  it('does not throw when the gateway server is not initialised yet', () => {
    const logSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const early = new OrderEventsService({} as unknown as KitchenGateway);

    expect(() => early.emitOrderCreated(orderWithItems)).not.toThrow();
    expect(logSpy).toHaveBeenCalledOnce();
    logSpy.mockRestore();
  });
});
