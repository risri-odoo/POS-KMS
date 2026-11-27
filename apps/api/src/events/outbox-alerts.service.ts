import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { haipPostOutbox, orders } from '@stayx/database';
import { DRIZZLE, type Db } from '../database/database.module.js';
import { isBridgeEnabled } from '../haip/haip.config.js';
import { OrderEventsService } from './order-events.service.js';

export const OUTBOX_ALERT_CONFIG = Symbol('OUTBOX_ALERT_CONFIG');

export interface OutboxAlertConfig {
  /** A pending charge older than this is "stuck" (OUTBOX_STUCK_AFTER_MINUTES, default 30). */
  stuckAfterMs: number;
  /** How often to look for charges that became stuck just by time passing. */
  scanIntervalMs: number;
  /** Stuck only means something while the HAIP bridge is on; with it off nothing is ever sent. */
  bridgeEnabled: boolean;
}

export function loadOutboxAlertConfig(env: NodeJS.ProcessEnv = process.env): OutboxAlertConfig {
  const raw = env['OUTBOX_STUCK_AFTER_MINUTES']?.trim();
  const minutes = raw ? Number(raw) : 30;
  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new Error(`OUTBOX_STUCK_AFTER_MINUTES must be a whole number of minutes (1 or more), got "${raw}"`);
  }
  return { stuckAfterMs: minutes * 60_000, scanIntervalMs: 60_000, bridgeEnabled: isBridgeEnabled(env) };
}

/** What needs a manager at one hotel (GET /outbox/summary). */
export interface OutboxSummary {
  needsAttention: number;
  failed: number;
  /** Pending longer than stuckAfterMinutes while the HAIP bridge is on. */
  stuck: number;
  /** needsAttention + failed + stuck: the badge count. */
  total: number;
  /** When the oldest charge counted in total was created; null if none. */
  oldestAt: string | null;
  stuckAfterMinutes: number;
  bridgeEnabled: boolean;
}

export const OUTBOX_ATTENTION_CHANGED = 'outbox.attention_changed';

/**
 * Tells managers when a charge needs them (AUDIT.md item 15): counts per hotel, a socket
 * event when a hotel's count changes, and a warn log line for each charge that gets stuck.
 */
@Injectable()
export class OutboxAlerts implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxAlerts.name);
  /** The count last sent per hotel, so the event goes out only on a change. */
  private readonly lastCount = new Map<string, number>();
  /** Stuck charges already logged, so each is logged once. */
  private readonly loggedStuck = new Set<string>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly events: OrderEventsService,
    @Inject(OUTBOX_ALERT_CONFIG) readonly config: OutboxAlertConfig,
    @Inject('NOW') private readonly now: () => number = Date.now,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env['NODE_ENV'] === 'test') return;
    this.timer = setInterval(() => void this.scan(), this.config.scanIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Pending charges created before this are stuck (only while the bridge is on). */
  stuckCutoff(): Date | null {
    return this.config.bridgeEnabled ? new Date(this.now() - this.config.stuckAfterMs) : null;
  }

  async summary(propertyId: string): Promise<OutboxSummary> {
    const cutoff = this.stuckCutoff();
    const isStuck = cutoff ? sql`(${haipPostOutbox.status} = 'pending' and ${haipPostOutbox.createdAt} < ${cutoff})` : sql`false`;
    const counted = sql`(${haipPostOutbox.status} in ('needs_attention', 'failed') or ${isStuck})`;
    const [row] = await this.db
      .select({
        needsAttention: sql<number>`count(*) filter (where ${haipPostOutbox.status} = 'needs_attention')`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${haipPostOutbox.status} = 'failed')`.mapWith(Number),
        stuck: sql<number>`count(*) filter (where ${isStuck})`.mapWith(Number),
        oldestAt: sql<string | null>`min(${haipPostOutbox.createdAt}) filter (where ${counted})`,
      })
      .from(haipPostOutbox)
      .where(eq(haipPostOutbox.propertyId, propertyId));
    const needsAttention = row?.needsAttention ?? 0;
    const failed = row?.failed ?? 0;
    const stuck = row?.stuck ?? 0;
    return {
      needsAttention,
      failed,
      stuck,
      total: needsAttention + failed + stuck,
      oldestAt: row?.oldestAt ? new Date(row.oldestAt).toISOString() : null,
      stuckAfterMinutes: this.config.stuckAfterMs / 60_000,
      bridgeEnabled: this.config.bridgeEnabled,
    };
  }

  /**
   * Recount one hotel and send outbox.attention_changed if its count changed. Called after
   * a charge is parked, fails, posts, or is retried or resolved. Never throws: an alert
   * must not break the change that caused it.
   */
  async refresh(propertyId: string): Promise<void> {
    try {
      const { total } = await this.summary(propertyId);
      if (this.lastCount.get(propertyId) === total) return;
      this.lastCount.set(propertyId, total);
      this.events.emitOutboxAttention(propertyId, total);
    } catch (error) {
      this.logger.warn(`Could not refresh outbox alerts for ${propertyId}: ${(error as Error)?.message ?? String(error)}`);
    }
  }

  /** Every minute: log newly stuck charges once, and refresh every hotel with something to count. */
  async scan(): Promise<void> {
    try {
      const cutoff = this.stuckCutoff();
      const stuckNow = cutoff
        ? await this.db
            .select({ id: haipPostOutbox.id, propertyId: haipPostOutbox.propertyId, createdAt: haipPostOutbox.createdAt, orderNumber: orders.orderNumber, lastError: haipPostOutbox.lastError })
            .from(haipPostOutbox)
            .leftJoin(orders, and(eq(orders.id, haipPostOutbox.orderId), eq(orders.propertyId, haipPostOutbox.propertyId)))
            .where(and(eq(haipPostOutbox.status, 'pending'), lt(haipPostOutbox.createdAt, cutoff)))
        : [];
      const ids = new Set(stuckNow.map((r) => r.id));
      for (const r of stuckNow) {
        if (this.loggedStuck.has(r.id)) continue;
        this.loggedStuck.add(r.id);
        const minutes = Math.floor((this.now() - new Date(r.createdAt).getTime()) / 60_000);
        this.logger.warn(
          `Charge stuck: order ${r.orderNumber ?? r.id} at hotel ${r.propertyId} has waited ${minutes} min to post` +
            (r.lastError ? ` (last: ${r.lastError})` : ''),
        );
      }
      for (const id of this.loggedStuck) if (!ids.has(id)) this.loggedStuck.delete(id);

      const active = await this.db
        .selectDistinct({ propertyId: haipPostOutbox.propertyId })
        .from(haipPostOutbox)
        .where(inArray(haipPostOutbox.status, ['pending', 'needs_attention', 'failed']));
      // Also hotels whose last count was not 0, so a drop to 0 is sent.
      const hotels = new Set([...active.map((a) => a.propertyId), ...[...this.lastCount].filter(([, n]) => n > 0).map(([p]) => p)]);
      for (const propertyId of hotels) await this.refresh(propertyId);
    } catch (error) {
      this.logger.warn(`Outbox alert scan failed: ${(error as Error)?.message ?? String(error)}`);
    }
  }

  /** For /health/ready: minutes the oldest pending charge (any hotel) has waited; null if none. */
  async oldestPendingMinutes(): Promise<number | null> {
    const [row] = await this.db
      .select({ oldest: sql<string | null>`min(${haipPostOutbox.createdAt})` })
      .from(haipPostOutbox)
      .where(eq(haipPostOutbox.status, 'pending'));
    if (!row?.oldest) return null;
    return Math.max(0, Math.floor((this.now() - new Date(row.oldest).getTime()) / 60_000));
  }
}
