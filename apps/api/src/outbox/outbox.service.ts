import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { haipPostOutbox } from '@stayx/database';
import { DRIZZLE, type Db } from '../database/database.module.js';
import { HaipQueue } from '../haip/haip-queue.service.js';
import type { ListOutboxDto } from './dto/outbox.dto.js';

export type OutboxRow = typeof haipPostOutbox.$inferSelect;

/** Only rows a human has to deal with can be retried or resolved. */
const ACTIONABLE = ['needs_attention', 'failed'] as const;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly haipQueue: HaipQueue,
  ) {}

  list(dto: ListOutboxDto): Promise<OutboxRow[]> {
    const conditions = [eq(haipPostOutbox.propertyId, dto.propertyId)];
    if (dto.status) conditions.push(eq(haipPostOutbox.status, dto.status));
    return this.db
      .select()
      .from(haipPostOutbox)
      .where(and(...conditions))
      .orderBy(desc(haipPostOutbox.createdAt));
  }

  /** Send it to HAIP again. Safe for HAIP (same vendorTxnId), but see the failed-row warning. */
  async retry(id: string, propertyId: string): Promise<OutboxRow> {
    const row = await this.transitionActionable(id, propertyId, {
      status: 'pending',
      attempts: 0,
      lastError: null,
      nextRetryAt: null,
    });
    await this.haipQueue.enqueue(row.id).catch((error: unknown) => {
      this.logger.warn(`Could not queue retry for ${row.id} (sweeper will pick it up): ${(error as Error)?.message ?? error}`);
    });
    return row;
  }

  /** Staff checked the folio in HAIP and the charge is there: mark it posted without sending. */
  resolve(id: string, propertyId: string, haipChargeId?: string): Promise<OutboxRow> {
    return this.transitionActionable(id, propertyId, {
      status: 'posted',
      postedAt: new Date(),
      nextRetryAt: null,
      ...(haipChargeId ? { haipChargeId } : {}),
    });
  }

  /** Atomic: the WHERE requires an actionable status, so it can't race the worker. */
  private async transitionActionable(id: string, propertyId: string, changes: Partial<OutboxRow>): Promise<OutboxRow> {
    const [row] = await this.db
      .update(haipPostOutbox)
      .set({ ...changes, updatedAt: new Date() })
      .where(
        and(
          eq(haipPostOutbox.id, id),
          eq(haipPostOutbox.propertyId, propertyId),
          inArray(haipPostOutbox.status, [...ACTIONABLE]),
        ),
      )
      .returning();
    if (row) return row;

    const [existing] = await this.db
      .select({ status: haipPostOutbox.status })
      .from(haipPostOutbox)
      .where(and(eq(haipPostOutbox.id, id), eq(haipPostOutbox.propertyId, propertyId)));
    if (!existing) throw new NotFoundException(`Outbox entry ${id} not found`);
    throw new BadRequestException(
      `Outbox entry is ${existing.status}; only needs_attention or failed entries can be retried or resolved`,
    );
  }
}
