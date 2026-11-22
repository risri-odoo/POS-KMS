import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Worker } from 'bullmq';
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import { haipPostOutbox } from '@stayx/database';
import { DRIZZLE, type Db } from '../database/database.module.js';
import { HAIP_CONFIG, redisConnectionOptions, type HaipConfig } from './haip.config.js';
import { HAIP_QUEUE_NAME, HaipQueue, type HaipJobData } from './haip-queue.service.js';
import { autoPostAllowed } from './no-in-house-guard.js';
import { OutboxProcessor } from './outbox.processor.js';
import { throttledLog } from './throttled-log.js';

export const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_BATCH = 200;

/**
 * Runs the BullMQ worker and the sweeper. The sweeper is the safety net: on
 * start and every minute it re-adds jobs for pending rows that are due (lost
 * Redis jobs, enqueue failures, rows written while the bridge was disabled).
 * Re-adding uses the same jobId, so a job that already exists is not duplicated.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private worker: Worker<HaipJobData> | undefined;
  private sweepTimer: NodeJS.Timeout | undefined;
  private sweeping = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(HAIP_CONFIG) private readonly config: HaipConfig,
    private readonly queue: HaipQueue,
    private readonly processor: OutboxProcessor,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.enabled) {
      this.logger.warn(
        `HAIP bridge DISABLED (${this.config.disabledReason}). Delivered orders are still recorded in ` +
          'haip_post_outbox and will be posted once the bridge is configured.',
      );
      return;
    }
    if (!this.config.propertyId) {
      this.logger.warn('HAIP_PROPERTY_ID is not set: every outbox row will be marked needs_attention.');
    }
    if (!this.queue.active) return; // NODE_ENV=test

    this.logger.log(`HAIP bridge enabled: posting to ${this.config.apiUrl} for property ${this.config.propertyId ?? '(none)'}`);
    this.worker = new Worker<HaipJobData>(HAIP_QUEUE_NAME, (job) => this.processor.process(job), {
      connection: redisConnectionOptions(this.config.redisUrl),
      concurrency: 2,
    });
    const logWorkerError = throttledLog((m) => this.logger.error(m));
    this.worker.on('error', (err) => logWorkerError(`Worker error: ${err.message}`));

    void this.sweep();
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  /** Re-add jobs for due pending rows. Returns how many were (re)queued. */
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      // Cross-property on purpose: an internal job over our own outbox table.
      const due = await this.db
        .select({ id: haipPostOutbox.id })
        .from(haipPostOutbox)
        .where(
          and(
            eq(haipPostOutbox.status, 'pending'),
            or(isNull(haipPostOutbox.nextRetryAt), lte(haipPostOutbox.nextRetryAt, new Date())),
            autoPostAllowed(),
          ),
        )
        .orderBy(asc(haipPostOutbox.createdAt))
        .limit(SWEEP_BATCH);
      for (const row of due) await this.queue.enqueue(row.id);
      if (due.length > 0) this.logger.log(`Sweeper queued ${due.length} pending outbox row(s)`);
      return due.length;
    } catch (error) {
      this.logger.warn(`Sweep failed (will retry): ${(error as Error)?.message ?? error}`);
      return 0;
    } finally {
      this.sweeping = false;
    }
  }

  async onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await this.worker?.close();
  }
}
