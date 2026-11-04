import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { haipPostOutbox, orderItems, orders } from '@stayx/database';
import { DRIZZLE, type Db } from '../database/database.module.js';
import { buildInboundCharge } from './charge-mapper.js';
import { HaipClient } from './haip-client.js';
import { HAIP_CONFIG, type HaipConfig } from './haip.config.js';
import { HAIP_JOB_ATTEMPTS, backoffDelayMs, type HaipJobData } from './haip-queue.service.js';
import { NO_IN_HOUSE_GUEST_PREFIX, isNoInHouseGuestError } from './no-in-house-guard.js';

export const HAIP_CLIENT = Symbol('HAIP_CLIENT');

/** The parts of a BullMQ Job the processor uses (keeps it testable without Redis). */
export interface OutboxJob {
  data: HaipJobData;
  attemptsMade: number;
  opts: { attempts?: number };
}

export type ProcessOutcome = 'skipped' | 'posted' | 'needs_attention' | 'failed';

export const MAY_BE_POSTED_PREFIX = 'May already be posted in HAIP, verify the folio before retrying';
export const WRONG_PROPERTY_ERROR = 'No HAIP key configured for this property';

type OutboxRow = typeof haipPostOutbox.$inferSelect;

/** Thrown to make BullMQ back off and retry. */
export class HaipRetryableError extends Error {
  override name = 'HaipRetryableError';
}

@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(HAIP_CLIENT) private readonly client: HaipClient,
    @Inject(HAIP_CONFIG) private readonly config: HaipConfig,
  ) {}

  async process(job: OutboxJob): Promise<ProcessOutcome> {
    // Multi-tenancy exception: a trusted server-side job id (the outbox row id
    // we created), not request input. Every query after this one is scoped by
    // the row's propertyId.
    const [row] = await this.db.select().from(haipPostOutbox).where(eq(haipPostOutbox.id, job.data.outboxId));

    // Idempotent: posted, resolved or parked rows are never sent again.
    if (!row || row.status !== 'pending') return 'skipped';

    // Belt and braces: retry and the sweeper already exclude these rows, but a
    // row put back to pending by hand must still never be re-sent.
    if (isNoInHouseGuestError(row.lastError)) {
      await this.finish(row, { status: 'needs_attention', nextRetryAt: null });
      this.logger.warn(`Not re-posting ${row.vendorTxnId}: room had no in-house guest`);
      return 'needs_attention';
    }

    if (!this.config.propertyId || row.propertyId !== this.config.propertyId) {
      await this.finish(row, { status: 'needs_attention', lastError: WRONG_PROPERTY_ERROR });
      return 'needs_attention';
    }

    const [order] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, row.orderId), eq(orders.propertyId, row.propertyId)));
    if (!order) {
      await this.finish(row, { status: 'needs_attention', lastError: `Order ${row.orderId} not found` });
      return 'needs_attention';
    }
    const items = await this.db
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(and(eq(orderItems.orderId, order.id), eq(orderItems.propertyId, row.propertyId)));

    const charge = buildInboundCharge({ ...order, items }, row.vendorTxnId, this.config.timezone);
    const result = await this.client.postCharge(charge);
    const attempts = row.attempts + 1;

    switch (result.kind) {
      case 'created':
        await this.finish(row, {
          status: 'posted',
          attempts,
          haipChargeId: result.chargeId,
          postedAt: new Date(),
          lastError: null,
          nextRetryAt: null,
        });
        this.logger.log(`Posted ${row.vendorTxnId} to HAIP (charge ${result.chargeId ?? 'id not returned'})`);
        return 'posted';

      case 'rejected':
        // A human must fix it (room not in-house, validation, bad key). HAIP
        // rolled back, so a later manual retry is safe, except when the room had
        // no in-house guest: that row is resolve-only (see no-in-house-guard.ts).
        const rejection = `HAIP rejected (${result.status}): ${result.message}`;
        await this.finish(row, {
          status: 'needs_attention',
          attempts,
          lastError: isNoInHouseGuestError(result.message) ? `${NO_IN_HOUSE_GUEST_PREFIX}. ${rejection}` : rejection,
          nextRetryAt: null,
        });
        this.logger.warn(`HAIP rejected ${row.vendorTxnId}: ${result.message}`);
        return 'needs_attention';

      case 'unavailable': {
        // HAIP bug: re-sending a vendorTxnId it already has never double-charges,
        // but it answers 500 instead of returning the existing charge. So after a
        // timeout or 5xx, a later 500 may mean "already posted". We keep retrying
        // (safe: HAIP dedupes), and on the last attempt park the row as failed
        // with a warning that staff must check the folio before retrying.
        const maxAttempts = job.opts.attempts ?? HAIP_JOB_ATTEMPTS;
        if (job.attemptsMade + 1 >= maxAttempts) {
          await this.finish(row, {
            status: 'failed',
            attempts,
            lastError: `${MAY_BE_POSTED_PREFIX}. Last error: ${result.message}`,
            nextRetryAt: null,
          });
          this.logger.error(`Giving up on ${row.vendorTxnId} after ${attempts} attempts: ${result.message}`);
          return 'failed';
        }
        await this.finish(row, {
          attempts,
          lastError: result.message,
          nextRetryAt: new Date(Date.now() + backoffDelayMs(job.attemptsMade + 1)),
        });
        throw new HaipRetryableError(`HAIP unavailable for ${row.vendorTxnId}: ${result.message}`);
      }
    }
  }

  /**
   * Update the row only if it is still pending, so a staff "resolve" that
   * happened meanwhile is never overwritten by the worker.
   */
  private async finish(row: OutboxRow, changes: Partial<OutboxRow>): Promise<void> {
    await this.db
      .update(haipPostOutbox)
      .set({ ...changes, updatedAt: new Date() })
      .where(
        and(
          eq(haipPostOutbox.id, row.id),
          eq(haipPostOutbox.propertyId, row.propertyId),
          eq(haipPostOutbox.status, 'pending'),
        ),
      );
  }
}
