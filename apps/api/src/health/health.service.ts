import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../database/database.module.js';
import { HaipQueue } from '../haip/haip-queue.service.js';
import { OutboxAlerts } from '../events/outbox-alerts.service.js';

export type CheckState = 'up' | 'down' | 'not_used';

export interface Readiness {
  status: 'ok' | 'unavailable';
  checks: { database: CheckState; redis: CheckState };
  /** Reported, never failed on: how long the oldest pending charge has waited (minutes). */
  outbox: { oldestPendingMinutes: number | null };
}

/** Each dependency gets this long to answer, so a hung one can't hang the probe. */
export const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Readiness for load balancers and orchestrators (AUDIT.md item 11). Says only which
 * part is down; the reason goes to the server log, never to the caller.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly haipQueue: HaipQueue,
    private readonly alerts: OutboxAlerts,
    @Inject('HEALTH_CHECK_TIMEOUT_MS') private readonly timeoutMs: number = CHECK_TIMEOUT_MS,
  ) {}

  async readiness(): Promise<Readiness> {
    const [database, redis] = await Promise.all([
      this.check('database', async () => {
        await this.db.execute(sql`select 1`);
        return 'up' as const;
      }),
      this.check('redis', () => this.haipQueue.ping()),
    ]);
    // Information only: a backlog never makes the API "not ready".
    const oldestPendingMinutes = database === 'up' ? await withTimeout(this.alerts.oldestPendingMinutes(), this.timeoutMs).catch(() => null) : null;
    return {
      status: database === 'down' || redis === 'down' ? 'unavailable' : 'ok',
      checks: { database, redis },
      outbox: { oldestPendingMinutes },
    };
  }

  private async check(name: string, run: () => Promise<'up' | 'not_used'>): Promise<CheckState> {
    try {
      return await withTimeout(run(), this.timeoutMs);
    } catch (error) {
      this.logger.warn(`Readiness: ${name} is down: ${(error as Error)?.message ?? String(error)}`);
      return 'down';
    }
  }
}
