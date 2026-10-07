import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { HAIP_CONFIG, redisConnectionOptions, type HaipConfig } from './haip.config.js';
import { throttledLog } from './throttled-log.js';

export const HAIP_QUEUE_NAME = 'haip-post-outbox';
export const HAIP_JOB_NAME = 'post-charge';
export const HAIP_JOB_ATTEMPTS = 5;
export const HAIP_BACKOFF_DELAY_MS = 15_000;

export interface HaipJobData {
  outboxId: string;
}

/**
 * jobId = outbox row id, so adding the same row twice while a job exists is a
 * no-op. Jobs are removed when done: the DB row is the source of truth, and a
 * manual retry (or the sweeper) can then re-add the same jobId.
 */
export const HAIP_JOB_OPTIONS: Omit<JobsOptions, 'jobId'> = {
  attempts: HAIP_JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: HAIP_BACKOFF_DELAY_MS },
  removeOnComplete: true,
  removeOnFail: true,
};

/** Delay BullMQ applies after the n-th failed attempt (n >= 1). */
export function backoffDelayMs(failedAttempts: number): number {
  return HAIP_BACKOFF_DELAY_MS * 2 ** Math.max(0, failedAttempts - 1);
}

@Injectable()
export class HaipQueue implements OnModuleDestroy {
  private readonly logger = new Logger(HaipQueue.name);
  private queue: Queue<HaipJobData> | undefined;

  constructor(@Inject(HAIP_CONFIG) private readonly config: HaipConfig) {}

  /** No queue in tests or when the bridge is disabled. */
  get active(): boolean {
    return this.config.enabled && process.env['NODE_ENV'] !== 'test';
  }

  /** Add the job for an outbox row. No-op when inactive. Rejects if Redis is down. */
  async enqueue(outboxId: string): Promise<void> {
    if (!this.active) return;
    await this.getQueue().add(HAIP_JOB_NAME, { outboxId }, { ...HAIP_JOB_OPTIONS, jobId: outboxId });
  }

  private getQueue(): Queue<HaipJobData> {
    if (!this.queue) {
      // Fail fast instead of buffering forever while Redis is down; the sweeper recovers.
      this.queue = new Queue<HaipJobData>(HAIP_QUEUE_NAME, {
        connection: { ...redisConnectionOptions(this.config.redisUrl), enableOfflineQueue: false },
      });
      const logQueueError = throttledLog((m) => this.logger.warn(m));
      this.queue.on('error', (err) => logQueueError(`Queue connection error: ${err.message}`));
    }
    return this.queue;
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }
}
