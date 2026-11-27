import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/pg-proxy';
import * as schema from '@stayx/database';
import type { Db } from '../database/database.module.js';
import type { OrderEventsService } from './order-events.service.js';
import { OutboxAlerts, loadOutboxAlertConfig, type OutboxAlertConfig } from './outbox-alerts.service.js';

const A = 'a0000001-0000-4000-a000-000000000001';
const NOW = Date.parse('2026-11-27T12:00:00Z');
const config = (overrides: Partial<OutboxAlertConfig> = {}): OutboxAlertConfig => ({ stuckAfterMs: 30 * 60_000, scanIntervalMs: 60_000, bridgeEnabled: true, ...overrides });

/** The real queries through pg-proxy; `answer` decides the rows for each SQL text. */
function make(answer: (sql: string, params: unknown[]) => unknown[][], cfg = config()) {
  const seen: { sql: string; params: unknown[] }[] = [];
  const db = drizzle(
    async (sql, params) => {
      seen.push({ sql, params });
      return { rows: answer(sql, params) };
    },
    { schema },
  );
  const events = { emitOutboxAttention: vi.fn() };
  const alerts = new OutboxAlerts(db as unknown as Db, events as unknown as OrderEventsService, cfg, () => NOW);
  return { alerts, events, seen };
}

describe('loadOutboxAlertConfig', () => {
  it('defaults to 30 minutes and reads the bridge switch', () => {
    expect(loadOutboxAlertConfig({})).toMatchObject({ stuckAfterMs: 30 * 60_000, bridgeEnabled: false });
    expect(loadOutboxAlertConfig({ OUTBOX_STUCK_AFTER_MINUTES: '45', HAIP_BRIDGE_ENABLED: 'true' })).toMatchObject({ stuckAfterMs: 45 * 60_000, bridgeEnabled: true });
  });

  it('refuses a value that is not a whole number of minutes, so the API won’t start with it', () => {
    for (const bad of ['0', '-5', '1.5', 'half an hour']) {
      expect(() => loadOutboxAlertConfig({ OUTBOX_STUCK_AFTER_MINUTES: bad })).toThrow('OUTBOX_STUCK_AFTER_MINUTES');
    }
  });
});

describe('OutboxAlerts.summary', () => {
  it('counts needs attention, failed and stuck (pending older than the cutoff) for one hotel', async () => {
    const { alerts, seen } = make(() => [[2, 1, 3, '2026-11-27 08:00:00+00']]);
    expect(await alerts.summary(A)).toEqual({
      needsAttention: 2,
      failed: 1,
      stuck: 3,
      total: 6,
      oldestAt: '2026-11-27T08:00:00.000Z',
      stuckAfterMinutes: 30,
      bridgeEnabled: true,
    });
    expect(seen[0]!.sql).toContain(`"haip_post_outbox"."status" = 'pending' and "haip_post_outbox"."created_at" <`);
    const cutoff = NOW - 30 * 60_000;
    expect(seen[0]!.params.some((p) => (p instanceof Date ? p.getTime() : Date.parse(String(p))) === cutoff)).toBe(true);
    expect(seen[0]!.params).toContain(A);
  });

  it('with the bridge off, nothing counts as stuck (nothing is ever sent)', async () => {
    const { alerts, seen } = make(() => [[0, 0, 0, null]], config({ bridgeEnabled: false }));
    expect(await alerts.summary(A)).toMatchObject({ stuck: 0, total: 0, oldestAt: null, bridgeEnabled: false });
    expect(seen[0]!.sql).not.toContain("'pending'");
  });
});

describe('OutboxAlerts.refresh', () => {
  it('sends outbox.attention_changed only when the hotel’s count changes, including the drop to 0', async () => {
    let total = 2;
    const { alerts, events } = make(() => [[total, 0, 0, null]]);
    await alerts.refresh(A);
    await alerts.refresh(A);
    total = 0;
    await alerts.refresh(A);
    expect(events.emitOutboxAttention.mock.calls).toEqual([
      [A, 2],
      [A, 0],
    ]);
  });

  it('never throws: an alert must not break the change that caused it', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { alerts, events } = make(() => {
      throw new Error('db down');
    });
    await expect(alerts.refresh(A)).resolves.toBeUndefined();
    expect(events.emitOutboxAttention).not.toHaveBeenCalled();
  });
});

describe('OutboxAlerts.scan', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('logs each stuck charge once at warn, again only if it gets stuck anew, and refreshes its hotel', async () => {
    let stuckRows: unknown[][] = [['o1', A, '2026-11-27 11:00:00+00', 'RS-1001', 'Stay lookup unavailable, nothing sent yet']];
    const { alerts, events } = make((sql) => {
      if (sql.includes('left join "orders"')) return stuckRows;
      if (sql.startsWith('select distinct')) return [[A]];
      return [[0, 0, stuckRows.length, null]];
    });
    await alerts.scan();
    await alerts.scan();
    const stuckLogs = () => warn.mock.calls.filter(([m]: unknown[]) => String(m).startsWith('Charge stuck'));
    expect(stuckLogs()).toHaveLength(1);
    expect(String(stuckLogs()[0]![0])).toBe(`Charge stuck: order RS-1001 at hotel ${A} has waited 60 min to post (last: Stay lookup unavailable, nothing sent yet)`);
    expect(events.emitOutboxAttention).toHaveBeenCalledWith(A, 1);

    stuckRows = []; // posted
    await alerts.scan();
    expect(events.emitOutboxAttention).toHaveBeenLastCalledWith(A, 0);
    stuckRows = [['o1', A, '2026-11-27 11:00:00+00', 'RS-1001', null]]; // stuck again
    await alerts.scan();
    expect(stuckLogs()).toHaveLength(2);
  });
});

describe('OutboxAlerts.oldestPendingMinutes (for /health/ready)', () => {
  it('minutes the oldest pending charge has waited, or null', async () => {
    expect(await make(() => [['2026-11-27 11:15:00+00']]).alerts.oldestPendingMinutes()).toBe(45);
    expect(await make(() => [[null]]).alerts.oldestPendingMinutes()).toBeNull();
  });
});
