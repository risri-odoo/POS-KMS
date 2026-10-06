import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { orderItems, orders } from '@stayx/database';
import { DRIZZLE, type Db } from '../database/database.module.js';
import { MenuService } from '../menu/menu.service.js';
import { OrderEventsService } from '../events/order-events.service.js';
import { canTransition, type OrderStatus } from './order-status.js';
import { generateOrderNumber, priceOrder } from './order-pricing.js';
import type { CreateOrderDto, ListOrdersDto } from './dto/order.dto.js';

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderWithItems = Order & { items: OrderItem[] };

const ORDER_NUMBER_UNIQUE = 'orders_property_order_number_unique';
const MAX_ORDER_NUMBER_ATTEMPTS = 3;

/** True when a (possibly Drizzle-wrapped) postgres error is a unique violation on `constraint`. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let e: any = error; e; e = e.cause) {
    if (e.code === '23505' && e.constraint_name === constraint) return true;
  }
  return false;
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly menuService: MenuService,
    private readonly orderEvents: OrderEventsService,
  ) {}

  async create(dto: CreateOrderDto): Promise<OrderWithItems> {
    // A random 4-char suffix can collide within a day; the unique index catches
    // it and we retry the whole transaction with a fresh number.
    let order: OrderWithItems;
    for (let attempt = 1; ; attempt++) {
      try {
        order = await this.insertOrder(dto, generateOrderNumber());
        break;
      } catch (error) {
        if (attempt < MAX_ORDER_NUMBER_ATTEMPTS && isUniqueViolation(error, ORDER_NUMBER_UNIQUE)) continue;
        throw error;
      }
    }
    // Emit only after the transaction has committed; rolled-back attempts emit nothing.
    this.orderEvents.emitOrderCreated(order);
    return order;
  }

  private insertOrder(dto: CreateOrderDto, orderNumber: string): Promise<OrderWithItems> {
    return this.db.transaction(async (tx) => {
      const ids = [...new Set(dto.items.map((i) => i.menuItemId))];
      const menu = await this.menuService.findByIds(ids, dto.propertyId, tx as unknown as Db);
      // Prices come from the menu rows only — never from the client.
      const priced = priceOrder(new Map(menu.map((m) => [m.id, m])), dto.items);

      const [order] = await tx
        .insert(orders)
        .values({
          propertyId: dto.propertyId,
          orderNumber,
          roomNumber: dto.roomNumber,
          status: 'placed',
          subtotal: priced.subtotal,
          currencyCode: priced.currencyCode,
          notes: dto.notes,
          placedBy: dto.placedBy,
        })
        .returning();

      const items = await tx
        .insert(orderItems)
        .values(
          priced.lines.map((line) => ({
            propertyId: dto.propertyId,
            orderId: order!.id,
            menuItemId: line.menuItemId,
            name: line.name,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
            notes: line.notes,
          })),
        )
        .returning();

      return { ...order!, items };
    });
  }

  async list(dto: ListOrdersDto): Promise<Order[]> {
    const conditions = [eq(orders.propertyId, dto.propertyId)];
    if (dto.status) conditions.push(eq(orders.status, dto.status));

    return this.db
      .select()
      .from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt));
  }

  async findById(id: string, propertyId: string): Promise<OrderWithItems> {
    const [order] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.propertyId, propertyId)));
    if (!order) throw new NotFoundException(`Order ${id} not found`);

    const items = await this.db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.orderId, id), eq(orderItems.propertyId, propertyId)))
      .orderBy(asc(orderItems.createdAt));

    return { ...order, items };
  }

  async updateStatus(id: string, propertyId: string, status: OrderStatus): Promise<Order> {
    const updated = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(and(eq(orders.id, id), eq(orders.propertyId, propertyId)));
      if (!current) throw new NotFoundException(`Order ${id} not found`);

      if (!canTransition(current.status, status)) {
        throw new BadRequestException(`Cannot move order from ${current.status} to ${status}`);
      }

      const now = new Date();
      // Optimistic concurrency: the WHERE also pins the status we validated
      // against, so a concurrent change makes this match zero rows → 409.
      const [row] = await tx
        .update(orders)
        .set({
          status,
          updatedAt: now,
          ...(status === 'delivered' ? { deliveredAt: now } : {}),
          ...(status === 'cancelled' ? { cancelledAt: now } : {}),
        })
        .where(and(eq(orders.id, id), eq(orders.propertyId, propertyId), eq(orders.status, current.status)))
        .returning();
      if (!row) {
        throw new ConflictException(`Order ${id} was modified concurrently; reload and retry`);
      }

      // Phase 4: on delivered, insert haip_post_outbox row in the same transaction

      return row;
    });

    // Committed: now tell the kitchen display.
    this.orderEvents.emitOrderStatusChanged(updated);
    return updated;
  }
}
