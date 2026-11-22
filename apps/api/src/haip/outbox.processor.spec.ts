import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { haipPostOutbox, orderItems, orders } from '@stayx/database';
import { HaipRetryableError, MAY_BE_POSTED_PREFIX, OutboxProcessor, WRONG_PROPERTY_ERROR, type OutboxJob } from './outbox.processor.js';
import type { HaipClient, HaipPostResult } from './haip-client.js';
import type { HaipConfig } from './haip.config.js';
import type { Db } from '../database/database.module.js';
import { HAIP_NO_IN_HOUSE_TEXT, NO_IN_HOUSE_GUEST_PREFIX, isNoInHouseGuestError } from './no-in-house-guard.js';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const OUTBOX_ID = '55555555-5555-4555-8555-555555555555';

const config: HaipConfig = {
  apiUrl: 'http://haip.test/api/v1',
  apiKey: 'unused-in-processor',
  propertyId: PROPERTY_ID,
  timezone: 'America/New_York',
  redisUrl: 'redis://localhost:6380',
  enabled: true,
  disabledReason: undefined,
};

function outboxRow(overrides: Partial<typeof haipPostOutbox.$inferSelect> = {}) {
  return {
    id: OUTBOX_ID,
    propertyId: PROPERTY_ID,
    orderId: ORDER_ID,
    vendorTxnId: `stayx-rs-${ORDER_ID}`,
    status: 'pending' as const,
    attempts: 0,
    lastError: null,
    nextRetryAt: null,
    haipChargeId: null,
    postedAt: null,
    haipReservationId: null,
    haipFolioId: null,
    parkedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const order = {
  id: ORDER_ID,
  propertyId: PROPERTY_ID,
  orderNumber: 'RS-261005-A1B2',
  roomNumber: '1204',
  status: 'delivered',
  subtotal: '34.75',
  currencyCode: 'USD',
  deliveredAt: new Date('2026-10-06T02:30:00Z'),
  updatedAt: new Date('2026-10-06T02:30:00Z'),
};

/** Fake db: select results keyed by table; every update's .set() payload is recorded. */
function fakeDb(row: ReturnType<typeof outboxRow> | undefined) {
  const updates: Record<string, unknown>[] = [];
  const results = new Map<unknown, unknown[]>([
    [haipPostOutbox, row ? [row] : []],
    [orders, [order]],
    [orderItems, [{ id: 'i1' }, { id: 'i2' }]],
  ]);
  const db = {
    select: () => ({ from: (table: unknown) => ({ where: () => Promise.resolve(results.get(table) ?? []) }) }),
    update: () => ({
      set: (changes: Record<string, unknown>) => {
        updates.push(changes);
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
  return { db: db as unknown as Db, updates };
}

function job(attemptsMade = 0, attempts = 5): OutboxJob {
  return { data: { outboxId: OUTBOX_ID }, attemptsMade, opts: { attempts } };
}

describe('OutboxProcessor', () => {
  let postCharge: ReturnType<typeof vi.fn<(c: unknown) => Promise<HaipPostResult>>>;
  const make = (row: ReturnType<typeof outboxRow> | undefined, cfg: HaipConfig = config) => {
    const { db, updates } = fakeDb(row);
    return { processor: new OutboxProcessor(db, { postCharge } as unknown as HaipClient, cfg), updates };
  };

  beforeEach(() => {
    postCharge = vi.fn();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('201 → posts the pre-tax charge once and marks the row posted', async () => {
    postCharge.mockResolvedValue({ kind: 'created', chargeId: 'haip-charge-9' });
    const { processor, updates } = make(outboxRow());

    await expect(processor.process(job())).resolves.toBe('posted');

    expect(postCharge).toHaveBeenCalledExactlyOnceWith({
      roomNumber: '1204',
      type: 'food_beverage',
      amount: '34.75',
      currencyCode: 'USD',
      vendorTxnId: `stayx-rs-${ORDER_ID}`,
      description: 'Room service RS-261005-A1B2 (2 item lines)',
      serviceDate: '2026-10-05',
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: 'posted', attempts: 1, haipChargeId: 'haip-charge-9', lastError: null });
    expect(updates[0]!['postedAt']).toBeInstanceOf(Date);
  });

  it('400 → needs_attention with the reason, and does not throw (no retry)', async () => {
    postCharge.mockResolvedValue({ kind: 'rejected', status: 400, message: 'HTTP 400: Room 999 is vacant' });
    const { processor, updates } = make(outboxRow());

    await expect(processor.process(job())).resolves.toBe('needs_attention');
    expect(updates[0]).toMatchObject({
      status: 'needs_attention',
      attempts: 1,
      lastError: 'HAIP rejected (400): HTTP 400: Room 999 is vacant',
      parkedReason: 'haip_rejected',
    });
  });

  it('400 "no in-house reservation" → needs_attention marked as do-not-re-post', async () => {
    postCharge.mockResolvedValue({
      kind: 'rejected',
      status: 400,
      message: `HTTP 400: Room 110 ${HAIP_NO_IN_HOUSE_TEXT}`,
    });
    const { processor, updates } = make(outboxRow());

    await expect(processor.process(job())).resolves.toBe('needs_attention');
    expect(updates[0]).toMatchObject({
      status: 'needs_attention',
      attempts: 1,
      lastError: `${NO_IN_HOUSE_GUEST_PREFIX}. HAIP rejected (400): HTTP 400: Room 110 ${HAIP_NO_IN_HOUSE_TEXT}`,
      parkedReason: 'no_in_house_guest',
    });
    expect(isNoInHouseGuestError(updates[0]!['lastError'] as string)).toBe(true);
  });

  it.each(['no_in_house_guest', 'stay_ended', 'needs_verification', 'wrong_property', 'haip_rejected'] as const)(
    'a pending row with parked reason %s (set back by hand) is never sent, and keeps its reason',
    async (parkedReason) => {
      const { processor, updates } = make(outboxRow({ parkedReason }));

      await expect(processor.process(job())).resolves.toBe('needs_attention');
      expect(postCharge).not.toHaveBeenCalled();
      expect(updates).toEqual([{ status: 'needs_attention', nextRetryAt: null, updatedAt: expect.any(Date) }]);
    },
  );

  it('a pending row reset by hand before parked_reason existed is never sent, and gets the reason', async () => {
    const { processor, updates } = make(
      outboxRow({ lastError: `HAIP rejected (400): HTTP 400: Room 110 ${HAIP_NO_IN_HOUSE_TEXT}` }),
    );

    await expect(processor.process(job())).resolves.toBe('needs_attention');
    expect(postCharge).not.toHaveBeenCalled();
    expect(updates).toEqual([
      { status: 'needs_attention', nextRetryAt: null, parkedReason: 'no_in_house_guest', updatedAt: expect.any(Date) },
    ]);
  });

  it('500 on a non-final attempt → records the error and nextRetryAt, then throws for BullMQ to back off', async () => {
    postCharge.mockResolvedValue({ kind: 'unavailable', status: 500, message: 'HTTP 500: Internal server error' });
    const { processor, updates } = make(outboxRow({ attempts: 1 }));

    await expect(processor.process(job(1))).rejects.toBeInstanceOf(HaipRetryableError);
    expect(updates[0]).toMatchObject({ attempts: 2, lastError: 'HTTP 500: Internal server error' });
    expect(updates[0]).not.toHaveProperty('status'); // still pending
    expect((updates[0]!['nextRetryAt'] as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('500 on the FINAL attempt → failed with the verify prefix, and does not throw', async () => {
    postCharge.mockResolvedValue({ kind: 'unavailable', status: 500, message: 'HTTP 500: Internal server error' });
    const { processor, updates } = make(outboxRow({ attempts: 4 }));

    await expect(processor.process(job(4, 5))).resolves.toBe('failed');
    expect(updates[0]).toMatchObject({ status: 'failed', attempts: 5, nextRetryAt: null });
    expect(updates[0]!['lastError']).toBe(`${MAY_BE_POSTED_PREFIX}. Last error: HTTP 500: Internal server error`);
  });

  it.each(['posted', 'needs_attention', 'failed'] as const)('a %s row makes no HTTP call and no update', async (status) => {
    const { processor, updates } = make(outboxRow({ status }));
    await expect(processor.process(job())).resolves.toBe('skipped');
    expect(postCharge).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('a missing row is skipped', async () => {
    const { processor } = make(undefined);
    await expect(processor.process(job())).resolves.toBe('skipped');
    expect(postCharge).not.toHaveBeenCalled();
  });

  it('a row for another property → needs_attention, no HTTP call', async () => {
    const { processor, updates } = make(outboxRow({ propertyId: '22222222-2222-4222-8222-222222222222' }));
    await expect(processor.process(job())).resolves.toBe('needs_attention');
    expect(postCharge).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: 'needs_attention', lastError: WRONG_PROPERTY_ERROR, parkedReason: 'wrong_property' });
  });

  it('no HAIP_PROPERTY_ID configured → needs_attention, no HTTP call', async () => {
    const { processor, updates } = make(outboxRow(), { ...config, propertyId: undefined });
    await expect(processor.process(job())).resolves.toBe('needs_attention');
    expect(postCharge).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ lastError: WRONG_PROPERTY_ERROR, parkedReason: 'wrong_property' });
  });
});
