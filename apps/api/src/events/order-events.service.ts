import { Injectable, Logger } from '@nestjs/common';
import type { Order, OrderWithItems } from '../orders/orders.service.js';
import { KitchenGateway, roomFor } from './kitchen.gateway.js';

export const ORDER_CREATED = 'order.created';
export const ORDER_STATUS_CHANGED = 'order.status_changed';

/**
 * Pushes order changes to the kitchen display. Events go ONLY to the order's
 * property room, never to every socket. Emitting is best effort: a failure is
 * logged and swallowed so it can never break the HTTP request that caused it.
 */
@Injectable()
export class OrderEventsService {
  private readonly logger = new Logger(OrderEventsService.name);

  constructor(private readonly gateway: KitchenGateway) {}

  /** Payload: the full order including items. */
  emitOrderCreated(order: OrderWithItems): void {
    this.emit(ORDER_CREATED, order.propertyId, order);
  }

  /** Payload: the updated order row, without items. */
  emitOrderStatusChanged(order: Order): void {
    this.emit(ORDER_STATUS_CHANGED, order.propertyId, order);
  }

  /**
   * The hotel's count of charges needing a manager (AUDIT.md item 15). Sent to the hotel's
   * room: it is a number only, and the POS shows it to managers only.
   */
  emitOutboxAttention(propertyId: string, count: number): void {
    this.emit('outbox.attention_changed', propertyId, { propertyId, count });
  }

  private emit(event: string, propertyId: string, payload: unknown): void {
    try {
      this.gateway.server.to(roomFor(propertyId)).emit(event, payload);
    } catch (error) {
      this.logger.error(
        `Failed to emit ${event} for property ${propertyId}: ${(error as Error)?.message ?? error}`,
      );
    }
  }
}
