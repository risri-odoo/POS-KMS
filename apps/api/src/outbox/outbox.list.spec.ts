import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pg-proxy';
import * as schema from '@stayx/database';
import { haipPostOutbox } from '@stayx/database';
import type { Db } from '../database/database.module.js';
import type { HaipQueue } from '../haip/haip-queue.service.js';
import { OutboxService } from './outbox.service.js';
import type { PropertyDirectory } from '../properties/properties.service.js';
import type { OutboxAlerts } from '../events/outbox-alerts.service.js';

const PROPERTY = 'a0000001-0000-4000-a000-000000000001';

const whereOf = (sql: string) => sql.slice(sql.indexOf(' where '));

/** The real query, captured through drizzle's pg-proxy driver; answers with `rows`. */
function capture(rows: unknown[][] = [], directory: PropertyDirectory = { find: () => Promise.resolve(null) }, stuckCutoff: Date | null = null) {
  const seen: { sql: string; params: unknown[] }[] = [];
  const db = drizzle(
    async (sql, params) => {
      seen.push({ sql, params });
      return { rows };
    },
    { schema },
  );
  const alerts = { stuckCutoff: () => stuckCutoff, refresh: () => Promise.resolve() } as unknown as OutboxAlerts;
  return { service: new OutboxService(db as unknown as Db, {} as HaipQueue, directory, alerts), seen };
}

describe('OutboxService.list', () => {
  it('joins each row to its order, in the same hotel on both sides, newest first, limited', async () => {
    const { service, seen } = capture();
    await service.list({ propertyId: PROPERTY });
    const { sql } = seen[0]!;
    expect(sql).toContain('left join "orders" on ("orders"."id" = "haip_post_outbox"."order_id" and "orders"."property_id" = "haip_post_outbox"."property_id")');
    expect(sql).toContain('order by "haip_post_outbox"."created_at" desc');
    expect(sql).toMatch(/limit \$\d+$/);
    expect(seen[0]!.params.at(-1)).toBe(100);
  });

  it('by default shows only rows a person must deal with', async () => {
    const { service, seen } = capture();
    await service.list({ propertyId: PROPERTY });
    expect(seen[0]!.sql).toContain('"haip_post_outbox"."status" in ($2, $3)');
    expect(seen[0]!.params.slice(0, 3)).toEqual([PROPERTY, 'needs_attention', 'failed']);
  });

  it('with the bridge on, "Needs attention" also shows charges stuck in pending', async () => {
    const cutoff = new Date('2026-11-27T10:00:00Z');
    const { service, seen } = capture([], undefined, cutoff);
    await service.list({ propertyId: PROPERTY });
    expect(seen[0]!.sql).toContain('("haip_post_outbox"."status" in ($2, $3) or ("haip_post_outbox"."status" = $4 and "haip_post_outbox"."created_at" < $5))');
    expect(seen[0]!.params.slice(1, 5)).toEqual(['needs_attention', 'failed', 'pending', cutoff.toISOString()]);
  });

  it('view=all drops the status filter; an explicit status wins over the view', async () => {
    const all = capture();
    await all.service.list({ propertyId: PROPERTY, view: 'all' });
    expect(whereOf(all.seen[0]!.sql)).not.toContain('"haip_post_outbox"."status"');

    const resolved = capture();
    await resolved.service.list({ propertyId: PROPERTY, view: 'attention', status: 'resolved' });
    expect(resolved.seen[0]!.sql).toContain('"haip_post_outbox"."status" = $2');
    expect(resolved.seen[0]!.params[1]).toBe('resolved');
  });

  it('filters by parked reason and by resolution type', async () => {
    const { service, seen } = capture();
    await service.list({ propertyId: PROPERTY, view: 'all', parkedReason: 'stay_ended', resolutionType: 'written_off', limit: 20 });
    expect(seen[0]!.sql).toContain('"haip_post_outbox"."parked_reason" = $2');
    expect(seen[0]!.sql).toContain('"haip_post_outbox"."resolution_type" = $3');
    expect(seen[0]!.params).toEqual([PROPERTY, 'stay_ended', 'written_off', 20]);
  });

  it('returns the row fields at the top level and the order under `order`', async () => {
    const columns = Object.keys(getTableColumns(haipPostOutbox));
    const values: Record<string, unknown> = {
      id: 'o1', propertyId: PROPERTY, orderId: 'ord-1', vendorTxnId: 'stayx-rs-ord-1', status: 'needs_attention', attempts: 2,
      parkedReason: 'stay_ended', resolutionType: null, createdAt: '2026-11-27 10:00:00+00', updatedAt: '2026-11-27 10:00:00+00',
    };
    const orderValues = ['RS-261127-AB12', '101', '12.50', 'USD', 'pos-staff-1', '2026-11-27 09:55:00+00', 'verified', 'Ada L.'];
    const { service } = capture([[...columns.map((c) => values[c] ?? null), ...orderValues]]);

    const [entry] = await service.list({ propertyId: PROPERTY });

    expect(entry).toMatchObject({ id: 'o1', orderId: 'ord-1', status: 'needs_attention', parkedReason: 'stay_ended', attempts: 2 });
    expect(entry!.order).toMatchObject({
      orderNumber: 'RS-261127-AB12',
      roomNumber: '101',
      subtotal: '12.50',
      currencyCode: 'USD',
      placedBy: 'pos-staff-1',
      verificationStatus: 'verified',
      guestName: 'Ada L.',
    });
    expect(entry).not.toHaveProperty('roomNumber');
  });

  it('retryAllowed: "Hotel not set up" only once the hotel’s key is set; resolve-only reasons never', async () => {
    const columns = Object.keys(getTableColumns(haipPostOutbox));
    const rowWith = (id: string, status: string, parkedReason: string | null) => [
      ...columns.map((c) => ({ id, status, parkedReason, propertyId: PROPERTY })[c as 'id'] ?? null),
      null, null, null, null, null, null, null, null,
    ];
    const rows = [rowWith('a', 'needs_attention', 'wrong_property'), rowWith('b', 'needs_attention', 'stay_ended'), rowWith('c', 'failed', null), rowWith('d', 'posted', null)];
    const hotel = (keyEnv: string) => ({ find: () => Promise.resolve({ id: PROPERTY, name: 'Demo hotel', haipApiKeyEnv: keyEnv, active: true } as never) });

    process.env['HAIP_KEY_LISTTEST'] = 'k';
    const withKey = await capture(rows, hotel('HAIP_KEY_LISTTEST')).service.list({ propertyId: PROPERTY, view: 'all' });
    expect(withKey.map((e) => [e.id, e.retryAllowed])).toEqual([['a', true], ['b', false], ['c', true], ['d', false]]);

    delete process.env['HAIP_KEY_LISTTEST'];
    const withoutKey = await capture(rows, hotel('HAIP_KEY_LISTTEST')).service.list({ propertyId: PROPERTY, view: 'all' });
    expect(withoutKey.find((e) => e.id === 'a')!.retryAllowed).toBe(false);
  });

  it('order is null if the order row is missing (never another hotel’s order)', async () => {
    const columns = Object.keys(getTableColumns(haipPostOutbox));
    const { service } = capture([[...columns.map((c) => (c === 'id' ? 'o2' : null)), null, null, null, null, null, null, null, null]]);
    const [entry] = await service.list({ propertyId: PROPERTY });
    expect(entry!.order).toBeNull();
  });
});
