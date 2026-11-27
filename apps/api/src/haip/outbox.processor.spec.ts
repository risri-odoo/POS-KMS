import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { haipPostOutbox, orderItems, orders } from '@stayx/database';
import { HaipRetryableError, MAY_BE_POSTED_PREFIX, OutboxProcessor, WRONG_PROPERTY_ERROR, type OutboxJob } from './outbox.processor.js';
import type { HaipClient, HaipPostResult } from './haip-client.js';
import type { PropertyDirectory, PropertyRecord } from '../properties/properties.service.js';
import type { Db } from '../database/database.module.js';
import { HAIP_NO_IN_HOUSE_TEXT, NO_IN_HOUSE_GUEST_PREFIX, isNoInHouseGuestError } from './no-in-house-guard.js';
import { FakeStayLookup, type FakeStay } from './fake-stay-lookup.js';
import { NotConfiguredStayLookup, type StayLookup } from './stay-lookup.js';
import { STAY_LOOKUP_MAX_WAIT_MS } from './stay-recheck.js';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const OUTBOX_ID = '55555555-5555-4555-8555-555555555555';

/** The hotel the rows belong to: its key comes from HAIP_KEY_TEST, its timezone from the row. */
const HOTEL: PropertyRecord = {
  id: PROPERTY_ID,
  name: 'Demo hotel',
  currencyCode: 'USD',
  timezone: 'America/New_York',
  haipApiKeyEnv: 'HAIP_KEY_TEST',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const KEY = 'test-folio-key';
const directoryWith = (...hotels: PropertyRecord[]): PropertyDirectory => ({
  find: (id: string) => Promise.resolve(hotels.find((h) => h.id === id) ?? null),
});
const config = directoryWith(HOTEL);

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

/**
 * Fake db: select results keyed by table. Every outbox update's .set() payload is
 * recorded in `updates`; updates to the orders table go to `orderUpdates`.
 */
function fakeDb(row: ReturnType<typeof outboxRow> | undefined, orderRow: Record<string, unknown> = order) {
  const updates: Record<string, unknown>[] = [];
  const orderUpdates: Record<string, unknown>[] = [];
  const results = new Map<unknown, unknown[]>([
    [haipPostOutbox, row ? [row] : []],
    [orders, [orderRow]],
    [orderItems, [{ id: 'i1' }, { id: 'i2' }]],
  ]);
  const db = {
    select: () => ({ from: (table: unknown) => ({ where: () => Promise.resolve(results.get(table) ?? []) }) }),
    update: (table: unknown) => ({
      set: (changes: Record<string, unknown>) => {
        (table === orders ? orderUpdates : updates).push(changes);
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
  return { db: db as unknown as Db, updates, orderUpdates };
}

function job(attemptsMade = 0, attempts = 5): OutboxJob {
  return { data: { outboxId: OUTBOX_ID }, attemptsMade, opts: { attempts } };
}

describe('OutboxProcessor', () => {
  let postCharge: ReturnType<typeof vi.fn<(c: unknown) => Promise<HaipPostResult>>>;
  const make = (
    row: ReturnType<typeof outboxRow> | undefined,
    cfg: PropertyDirectory = config,
    opts: { lookup?: StayLookup; order?: Record<string, unknown> } = {},
  ) => {
    const { db, updates, orderUpdates } = fakeDb(row, opts.order);
    const lookup = opts.lookup ?? new NotConfiguredStayLookup();
    return { processor: new OutboxProcessor(db, { postCharge } as unknown as HaipClient, cfg, lookup), updates, orderUpdates };
  };

  beforeEach(() => {
    process.env['HAIP_KEY_TEST'] = KEY;
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
    }, KEY);
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
    expect(updates[0]).toMatchObject({ status: 'needs_attention', parkedReason: 'wrong_property' });
    expect(updates[0]!['lastError']).toBe(`${WRONG_PROPERTY_ERROR}: property 22222222-2222-4222-8222-222222222222 is unknown or inactive`);
  });

  it.each([
    ['has no key variable', { haipApiKeyEnv: null }, 'Demo hotel has no HAIP key configured'],
    ['names a variable outside HAIP_KEY_*', { haipApiKeyEnv: 'DATABASE_URL' }, '"DATABASE_URL" is not a HAIP_KEY_* variable'],
    ['names a variable that is not set', { haipApiKeyEnv: 'HAIP_KEY_MISSING' }, 'HAIP_KEY_MISSING is not set'],
  ])('a hotel that %s → parked as wrong_property, nothing sent, no key in the message', async (_label, change, reason) => {
    const { processor, updates } = make(outboxRow(), directoryWith({ ...HOTEL, ...change }));
    await expect(processor.process(job())).resolves.toBe('needs_attention');
    expect(postCharge).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ parkedReason: 'wrong_property' });
    expect(updates[0]!['lastError']).toContain(reason);
    expect(String(updates[0]!['lastError'])).not.toContain(KEY);
  });

  it('posts with the hotel’s own key and its timezone for the service date', async () => {
    postCharge.mockResolvedValue({ kind: 'created', chargeId: 'c-tokyo' });
    process.env['HAIP_KEY_TOKYO'] = 'tokyo-key';
    const { processor } = make(outboxRow(), directoryWith({ ...HOTEL, timezone: 'Asia/Tokyo', haipApiKeyEnv: 'HAIP_KEY_TOKYO' }));
    await processor.process(job());
    const [charge, key] = postCharge.mock.calls[0] as unknown as [{ serviceDate: string }, string];
    expect(key).toBe('tokyo-key');
    // Delivered 2026-10-05 in New York; the fixture's time falls on the 5th or 6th in Tokyo.
    expect(charge.serviceDate).toMatch(/^2026-10-0[56]$/);
    delete process.env['HAIP_KEY_TOKYO'];
  });

  describe('stay re-check before posting (Phase 1 step 6)', () => {
    const RES = '66666666-6666-4666-8666-666666666666';
    const FOLIO = '77777777-7777-4777-8777-777777777777';
    const stay = (overrides: Partial<FakeStay> = {}): FakeStay => ({
      propertyId: PROPERTY_ID,
      reservationId: RES,
      status: 'checked_in',
      roomNumber: '1204',
      departureDate: '2026-12-01',
      guestFolioId: FOLIO,
      occupants: [{ firstName: 'Ada', lastInitial: 'L' }],
      ...overrides,
    });
    const verifiedOrder = { ...order, verificationStatus: 'verified', haipReservationId: RES, haipFolioId: FOLIO, deliveredAt: new Date() };
    const unverifiedOrder = { ...order, verificationStatus: 'unverified', haipReservationId: null, haipFolioId: null, deliveredAt: new Date() };
    const boundRow = () => outboxRow({ haipReservationId: RES, haipFolioId: FOLIO });
    const sentRoom = () => (postCharge.mock.calls[0]![0] as { roomNumber: string }).roomNumber;

    it('HAIP_STAY_LOOKUP unset: keeps today’s path and posts by the order’s room, even for a bound order', async () => {
      postCharge.mockResolvedValue({ kind: 'created', chargeId: 'c1' });
      const { processor, updates } = make(boundRow(), config, { order: verifiedOrder, lookup: new NotConfiguredStayLookup() });

      await expect(processor.process(job())).resolves.toBe('posted');
      expect(sentRoom()).toBe('1204');
      expect(updates[0]).toMatchObject({ status: 'posted' });
    });

    it('HAIP_STAY_LOOKUP unset: an unverified order also posts by its room (default setup still posts)', async () => {
      postCharge.mockResolvedValue({ kind: 'created', chargeId: 'c1' });
      const { processor } = make(outboxRow(), config, { order: unverifiedOrder, lookup: new NotConfiguredStayLookup() });
      await expect(processor.process(job())).resolves.toBe('posted');
      expect(sentRoom()).toBe('1204');
    });

    it('HAIP_STAY_LOOKUP unset: the existing guard still parks a no-in-house rejection', async () => {
      postCharge.mockResolvedValue({ kind: 'rejected', status: 400, message: `HTTP 400: Room 1204 ${HAIP_NO_IN_HOUSE_TEXT}` });
      const { processor, updates } = make(outboxRow(), config, { order: unverifiedOrder, lookup: new NotConfiguredStayLookup() });
      await expect(processor.process(job())).resolves.toBe('needs_attention');
      expect(updates[0]).toMatchObject({ parkedReason: 'no_in_house_guest' });
    });

    it('bound stay still in-house and alone in its room: posts by that room', async () => {
      postCharge.mockResolvedValue({ kind: 'created', chargeId: 'c1' });
      const { processor } = make(boundRow(), config, { order: verifiedOrder, lookup: new FakeStayLookup([stay()]) });
      await expect(processor.process(job())).resolves.toBe('posted');
      expect(sentRoom()).toBe('1204');
    });

    it('room move: posts to the room the guest is in now, with the same vendorTxnId', async () => {
      postCharge.mockResolvedValue({ kind: 'created', chargeId: 'c1' });
      const { processor } = make(boundRow(), config, { order: verifiedOrder, lookup: new FakeStayLookup([stay({ roomNumber: '1510' })]) });

      await expect(processor.process(job())).resolves.toBe('posted');
      expect(postCharge).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ roomNumber: '1510', vendorTxnId: `stayx-rs-${ORDER_ID}` }), KEY);
    });

    it('checkout: parks as stay_ended and sends nothing', async () => {
      const { processor, updates } = make(boundRow(), config, { order: verifiedOrder, lookup: new FakeStayLookup([stay({ status: 'checked_out' })]) });

      await expect(processor.process(job())).resolves.toBe('needs_attention');
      expect(postCharge).not.toHaveBeenCalled();
      expect(updates).toEqual([
        expect.objectContaining({ status: 'needs_attention', parkedReason: 'stay_ended', nextRetryAt: null }),
      ]);
      expect(updates[0]!['lastError']).toMatch(/stay ended.*checked_out.*Nothing was sent/);
    });

    it('stay gone from HAIP: stay_ended, nothing sent', async () => {
      const { processor, updates } = make(boundRow(), config, { order: verifiedOrder, lookup: new FakeStayLookup([]) });
      await expect(processor.process(job())).resolves.toBe('needs_attention');
      expect(postCharge).not.toHaveBeenCalled();
      expect(updates[0]).toMatchObject({ parkedReason: 'stay_ended' });
    });

    it('room now shared with another in-house stay: needs_verification, nothing sent', async () => {
      const other = stay({ reservationId: '88888888-8888-4888-8888-888888888888', guestFolioId: null });
      const { processor, updates } = make(boundRow(), config, { order: verifiedOrder, lookup: new FakeStayLookup([stay(), other]) });

      await expect(processor.process(job())).resolves.toBe('needs_attention');
      expect(postCharge).not.toHaveBeenCalled();
      expect(updates[0]).toMatchObject({ parkedReason: 'needs_verification' });
    });

    it('re-checks on retries too: a stay that ended between attempts is not sent again', async () => {
      const lookup = new FakeStayLookup([stay()]);
      postCharge.mockResolvedValue({ kind: 'unavailable', status: 500, message: 'HTTP 500' });
      const first = make(boundRow(), config, { order: verifiedOrder, lookup });
      await expect(first.processor.process(job(0))).rejects.toBeInstanceOf(HaipRetryableError);
      expect(postCharge).toHaveBeenCalledTimes(1);

      lookup.checkOut(RES);
      const second = make(boundRow(), config, { order: verifiedOrder, lookup });
      await expect(second.processor.process(job(1))).resolves.toBe('needs_attention');
      expect(postCharge).toHaveBeenCalledTimes(1);
      expect(second.updates[0]).toMatchObject({ parkedReason: 'stay_ended' });
    });

    it('lookup unavailable soon after delivery: defers, sends nothing, keeps the row pending and the attempt count', async () => {
      const lookup = new FakeStayLookup([stay()]);
      lookup.setUnavailable('connect ECONNREFUSED');
      const { processor, updates } = make(outboxRow({ haipReservationId: RES, haipFolioId: FOLIO, attempts: 2 }), config, {
        order: verifiedOrder,
        lookup,
      });

      await expect(processor.process(job())).resolves.toBe('deferred');
      expect(postCharge).not.toHaveBeenCalled();
      expect(updates).toHaveLength(1);
      expect(updates[0]).not.toHaveProperty('status');
      expect(updates[0]).not.toHaveProperty('attempts');
      expect((updates[0]!['nextRetryAt'] as Date).getTime()).toBeGreaterThan(Date.now());
      expect(updates[0]!['lastError']).toMatch(/nothing sent yet/);
    });

    it(`lookup still unavailable ${STAY_LOOKUP_MAX_WAIT_MS / 3_600_000} hours after delivery: parks as needs_verification`, async () => {
      const lookup = new FakeStayLookup([stay()]);
      lookup.setUnavailable('connect ECONNREFUSED');
      const old = { ...verifiedOrder, deliveredAt: new Date(Date.now() - STAY_LOOKUP_MAX_WAIT_MS - 1000) };
      const { processor, updates } = make(boundRow(), config, { order: old, lookup });

      await expect(processor.process(job())).resolves.toBe('needs_attention');
      expect(postCharge).not.toHaveBeenCalled();
      expect(updates[0]).toMatchObject({ status: 'needs_attention', parkedReason: 'needs_verification', nextRetryAt: null });
    });

    it('unverified order, one in-house stay in its room: stores the ids, keeps it unverified, logs the match, then posts', async () => {
      const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      postCharge.mockResolvedValue({ kind: 'created', chargeId: 'c1' });
      const { processor, updates, orderUpdates } = make(outboxRow(), config, { order: unverifiedOrder, lookup: new FakeStayLookup([stay()]) });

      await expect(processor.process(job())).resolves.toBe('posted');

      expect(updates[0]).toEqual({ haipReservationId: RES, haipFolioId: FOLIO, updatedAt: expect.any(Date) });
      expect(orderUpdates).toEqual([{ haipReservationId: RES, haipFolioId: FOLIO }]);
      expect(orderUpdates[0]).not.toHaveProperty('verificationStatus');
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/matched at posting.*not confirmed by a person/));
      expect(sentRoom()).toBe('1204');
      expect(updates[1]).toMatchObject({ status: 'posted' });
    });

    it('unverified order, empty room: needs_verification, nothing sent, nothing attached', async () => {
      const { processor, updates, orderUpdates } = make(outboxRow(), config, { order: unverifiedOrder, lookup: new FakeStayLookup([]) });
      await expect(processor.process(job())).resolves.toBe('needs_attention');
      expect(postCharge).not.toHaveBeenCalled();
      expect(orderUpdates).toEqual([]);
      expect(updates[0]).toMatchObject({ parkedReason: 'needs_verification' });
    });

    it('unverified order, two in-house stays in its room: needs_verification, nothing sent', async () => {
      const other = stay({ reservationId: '88888888-8888-4888-8888-888888888888' });
      const { processor, updates } = make(outboxRow(), config, { order: unverifiedOrder, lookup: new FakeStayLookup([stay(), other]) });
      await expect(processor.process(job())).resolves.toBe('needs_attention');
      expect(postCharge).not.toHaveBeenCalled();
      expect(updates[0]).toMatchObject({ parkedReason: 'needs_verification' });
    });

    it('an order from before Phase 1 keeps today’s path even with a working lookup', async () => {
      postCharge.mockResolvedValue({ kind: 'created', chargeId: 'c1' });
      const { processor } = make(outboxRow(), config, { order: { ...order, verificationStatus: null }, lookup: new FakeStayLookup([]) });
      await expect(processor.process(job())).resolves.toBe('posted');
      expect(sentRoom()).toBe('1204');
    });
  });
});
