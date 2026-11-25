import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { haipPostOutbox, orderItems, orders } from '@stayx/database';
import { DRIZZLE, type Db } from '../database/database.module.js';
import { MenuService } from '../menu/menu.service.js';
import { OrderEventsService } from '../events/order-events.service.js';
import { vendorTxnIdFor } from '../haip/charge-mapper.js';
import { HaipQueue } from '../haip/haip-queue.service.js';
import { STAY_LOOKUP, type StayLookup } from '../haip/stay-lookup.js';
import { canTransition, type OrderStatus } from './order-status.js';
import { resolveStayBinding, type StayBinding } from './stay-binding.js';
import { generateOrderNumber, priceOrder } from './order-pricing.js';
import type { CreateOrderDto, ListOrdersDto } from './dto/order.dto.js';
import type { AuthPrincipal } from '../auth/token-verifier.js';

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderWithItems = Order & { items: OrderItem[] };

const ORDER_NUMBER_UNIQUE = 'orders_property_order_number_unique';
const MAX_ORDER_NUMBER_ATTEMPTS = 3;
/** orders.placed_by is varchar(100); usernames can be longer. */
const PLACED_BY_MAX = 100;

/** True when a (possibly Drizzle-wrapped) postgres error is a unique violation on `constraint`. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let e: any = error; e; e = e.cause) {
    if (e.code === '23505' && e.constraint_name === constraint) return true;
  }
  return false;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly menuService: MenuService,
    private readonly orderEvents: OrderEventsService,
    private readonly haipQueue: HaipQueue,
    @Inject(STAY_LOOKUP) private readonly stayLookup: StayLookup,
  ) {}

  /**
   * @param caller the signed-in staff member. When auth is on, placedBy comes from
   *   their token and any placedBy in the body is ignored (INTEGRATION_DESIGN.md §8.1).
   */
  async create(dto: CreateOrderDto, caller?: AuthPrincipal): Promise<OrderWithItems> {
    const placedBy = caller ? caller.username.slice(0, PLACED_BY_MAX) : dto.placedBy;
    // Which stay the order is for, checked with HAIP before anything is written.
    const binding = await resolveStayBinding(this.stayLookup, dto);

    // A random 4-char suffix can collide within a day; the unique index catches
    // it and we retry the whole transaction with a fresh number.
    let order: OrderWithItems;
    for (let attempt = 1; ; attempt++) {
      try {
        order = await this.insertOrder(dto, placedBy, binding, generateOrderNumber());
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

  private insertOrder(dto: CreateOrderDto, placedBy: string | undefined, binding: StayBinding, orderNumber: string): Promise<OrderWithItems> {
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
          placedBy,
          ...binding,
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

      // Delivered: record the HAIP folio post in the SAME transaction, so a
      // delivered order can never exist without its outbox row. The vendorTxnId
      // is deterministic and the unique index makes a repeat a no-op.
      let outboxId: string | undefined;
      if (status === 'delivered') {
        const [outbox] = await tx
          .insert(haipPostOutbox)
          .values({
            propertyId,
            orderId: row.id,
            vendorTxnId: vendorTxnIdFor(row.id),
            // The stay staff confirmed, if any; the worker re-checks it before posting.
            haipReservationId: row.haipReservationId ?? null,
            haipFolioId: row.haipFolioId ?? null,
          })
          .onConflictDoNothing({ target: [haipPostOutbox.propertyId, haipPostOutbox.vendorTxnId] })
          .returning({ id: haipPostOutbox.id });
        outboxId = outbox?.id;
      }

      return { row, outboxId };
    });

    // Committed. Queueing is best effort and not awaited, so a Redis outage
    // never slows or fails the request; the sweeper picks up anything missed.
    if (updated.outboxId) {
      const outboxId = updated.outboxId;
      this.haipQueue.enqueue(outboxId).catch((error: unknown) => {
        this.logger.warn(`Could not queue HAIP post ${outboxId} (sweeper will retry): ${(error as Error)?.message ?? error}`);
      });
    }
    // Tell the kitchen display.
    this.orderEvents.emitOrderStatusChanged(updated.row);
    return updated.row;
  }
}
