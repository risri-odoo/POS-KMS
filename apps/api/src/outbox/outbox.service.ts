import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, getTableColumns, inArray, type SQL } from 'drizzle-orm';
import { haipPostOutbox, orders } from '@stayx/database';
import { DRIZZLE, type Db } from '../database/database.module.js';
import { HaipQueue } from '../haip/haip-queue.service.js';
import { isResolveOnly, manualRetryAllowed, resolveOnlyMessage } from '../haip/no-in-house-guard.js';
import { PROPERTY_DIRECTORY, haipApiKeyFor, type PropertyDirectory } from '../properties/properties.service.js';
import type { AuthPrincipal } from '../auth/token-verifier.js';
import type { ListOutboxDto, ResolveOutboxDto, RetryOutboxDto } from './dto/outbox.dto.js';

export type OutboxRow = typeof haipPostOutbox.$inferSelect;

/** What the Outbox/Errors screen shows about the order behind a charge. */
export interface OutboxOrderSummary {
  orderNumber: string;
  roomNumber: string;
  subtotal: string;
  currencyCode: string;
  placedBy: string | null;
  deliveredAt: Date | null;
  verificationStatus: 'verified' | 'unverified' | null;
  /** The guest staff confirmed (first name and initial), if any. */
  guestName: string | null;
}

/** An outbox row with its order. Row fields stay at the top level. */
/**
 * An outbox row with its order. Row fields stay at the top level. retryAllowed: whether
 * Retry would be accepted now (the screen follows it instead of repeating the rules).
 */
export type OutboxEntry = OutboxRow & { order: OutboxOrderSummary | null; retryAllowed: boolean };

const DEFAULT_LIMIT = 100;
/** Who did it, from the staff token; null when login is off. Fits the 100-character columns. */
const actor = (caller?: AuthPrincipal) => caller?.username.slice(0, 100) ?? null;

/** Only rows a human has to deal with can be retried or resolved. */
const ACTIONABLE = ['needs_attention', 'failed'] as const;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly haipQueue: HaipQueue,
    @Inject(PROPERTY_DIRECTORY) private readonly directory: PropertyDirectory,
  ) {}

  /** The hotel is active and its HAIP_KEY_* variable is set now. */
  private async hotelKeyReady(propertyId: string): Promise<boolean> {
    const property = await this.directory.find(propertyId);
    return property !== null && haipApiKeyFor(property).ok;
  }

  /**
   * Newest first, with the order. Without a status, view "attention" (the default) shows
   * only rows a person must deal with; "all" shows everything.
   */
  async list(dto: ListOutboxDto): Promise<OutboxEntry[]> {
    const conditions: SQL[] = [eq(haipPostOutbox.propertyId, dto.propertyId)];
    if (dto.status) conditions.push(eq(haipPostOutbox.status, dto.status));
    else if ((dto.view ?? 'attention') === 'attention') conditions.push(inArray(haipPostOutbox.status, [...ACTIONABLE]));
    if (dto.parkedReason) conditions.push(eq(haipPostOutbox.parkedReason, dto.parkedReason));
    if (dto.resolutionType) conditions.push(eq(haipPostOutbox.resolutionType, dto.resolutionType));

    const rows = await this.db
      .select({
        ...getTableColumns(haipPostOutbox),
        orderNumber: orders.orderNumber,
        roomNumber: orders.roomNumber,
        subtotal: orders.subtotal,
        currencyCode: orders.currencyCode,
        placedBy: orders.placedBy,
        deliveredAt: orders.deliveredAt,
        verificationStatus: orders.verificationStatus,
        guestName: orders.verifiedGuestName,
      })
      .from(haipPostOutbox)
      // Same hotel on both sides, so a row can never show another hotel's order.
      .leftJoin(orders, and(eq(orders.id, haipPostOutbox.orderId), eq(orders.propertyId, haipPostOutbox.propertyId)))
      .where(and(...conditions))
      .orderBy(desc(haipPostOutbox.createdAt))
      .limit(dto.limit ?? DEFAULT_LIMIT);

    const keyReady = await this.hotelKeyReady(dto.propertyId);
    return rows.map(({ orderNumber, roomNumber, subtotal, currencyCode, placedBy, deliveredAt, verificationStatus, guestName, ...row }) => ({
      ...row,
      retryAllowed: ACTIONABLE.some((s) => s === row.status) && !isResolveOnly(row.parkedReason, keyReady),
      order:
        orderNumber === null || roomNumber === null || subtotal === null || currencyCode === null
          ? null
          : { orderNumber, roomNumber, subtotal, currencyCode, placedBy, deliveredAt, verificationStatus, guestName },
    }));
  }

  /**
   * Send it to HAIP again. Safe for HAIP (same vendorTxnId), but see the failed-row warning.
   * Allowed with no parked reason, or haip_rejected (the reason is cleared). Refused (409) for
   * resolve-only reasons: no_in_house_guest, stay_ended, needs_verification, wrong_property.
   */
  async retry(id: string, propertyId: string, dto: RetryOutboxDto = {}, caller?: AuthPrincipal): Promise<OutboxRow> {
    const keyReady = await this.hotelKeyReady(propertyId);
    const row = await this.transitionActionable(
      id,
      propertyId,
      {
        status: 'pending',
        attempts: 0,
        lastError: null,
        nextRetryAt: null,
        parkedReason: null,
        lastRetryBy: actor(caller),
        lastRetryAt: new Date(),
        lastRetryNote: dto.note || null,
      },
      manualRetryAllowed(keyReady),
      keyReady,
    );
    await this.haipQueue.enqueue(row.id).catch((error: unknown) => {
      this.logger.warn(`Could not queue retry for ${row.id} (sweeper will pick it up): ${(error as Error)?.message ?? error}`);
    });
    return row;
  }

  /**
   * A manager closes the row without sending anything. posted_manually: the charge is on
   * the folio (added in HAIP by staff), so the row becomes posted. Any other type closes it
   * as resolved: no folio charge, and it never counts as posted. parked_reason is kept, as
   * a record of why it needed a person.
   */
  async resolve(id: string, propertyId: string, dto: ResolveOutboxDto, caller?: AuthPrincipal): Promise<OutboxRow> {
    const postedManually = dto.resolutionType === 'posted_manually';
    if (dto.haipChargeId !== undefined && !postedManually) {
      throw new BadRequestException('haipChargeId is only allowed with resolutionType posted_manually');
    }
    const now = new Date();
    return this.transitionActionable(id, propertyId, {
      status: postedManually ? 'posted' : 'resolved',
      ...(postedManually ? { postedAt: now } : {}),
      ...(dto.haipChargeId ? { haipChargeId: dto.haipChargeId } : {}),
      nextRetryAt: null,
      resolutionType: dto.resolutionType,
      resolutionNote: dto.note,
      resolvedBy: actor(caller),
      resolvedAt: now,
    });
  }

  /** Atomic: the WHERE requires an actionable status (and `guard`), so it can't race the worker. */
  private async transitionActionable(
    id: string,
    propertyId: string,
    changes: Partial<OutboxRow>,
    guard?: SQL,
    hotelKeyReady = false,
  ): Promise<OutboxRow> {
    const [row] = await this.db
      .update(haipPostOutbox)
      .set({ ...changes, updatedAt: new Date() })
      .where(
        and(
          eq(haipPostOutbox.id, id),
          eq(haipPostOutbox.propertyId, propertyId),
          inArray(haipPostOutbox.status, [...ACTIONABLE]),
          guard,
        ),
      )
      .returning();
    if (row) return row;

    const [existing] = await this.db
      .select({ status: haipPostOutbox.status, parkedReason: haipPostOutbox.parkedReason })
      .from(haipPostOutbox)
      .where(and(eq(haipPostOutbox.id, id), eq(haipPostOutbox.propertyId, propertyId)));
    if (!existing) throw new NotFoundException(`Outbox entry ${id} not found`);
    if (guard && ACTIONABLE.some((s) => s === existing.status) && existing.parkedReason && isResolveOnly(existing.parkedReason, hotelKeyReady)) {
      throw new ConflictException(resolveOnlyMessage(existing.parkedReason));
    }
    throw new BadRequestException(
      `Outbox entry is ${existing.status}; only needs_attention or failed entries can be retried or resolved`,
    );
  }
}
