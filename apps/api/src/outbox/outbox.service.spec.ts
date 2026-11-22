import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { OutboxService, type OutboxRow } from './outbox.service.js';
import type { HaipQueue } from '../haip/haip-queue.service.js';
import type { Db } from '../database/database.module.js';
import { HAIP_NO_IN_HOUSE_TEXT, NO_IN_HOUSE_GUEST_PREFIX } from '../haip/no-in-house-guard.js';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const OUTBOX_ID = '55555555-5555-4555-8555-555555555555';
const NO_GUEST_ERROR = `${NO_IN_HOUSE_GUEST_PREFIX}. HAIP rejected (400): HTTP 400: Room 110 ${HAIP_NO_IN_HOUSE_TEXT}`;

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: OUTBOX_ID,
    propertyId: PROPERTY_ID,
    orderId: '33333333-3333-4333-8333-333333333333',
    vendorTxnId: 'stayx-rs-33333333-3333-4333-8333-333333333333',
    status: 'needs_attention',
    attempts: 1,
    lastError: 'HAIP rejected (422): HTTP 422: amount must be positive',
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

/**
 * Fake db. The conditional UPDATE "matches" when `updateMatches` is true (the
 * real WHERE is checked separately by rendering it); the fallback SELECT
 * returns `existing`.
 */
function fakeDb(opts: { updateMatches: boolean; existing?: Partial<OutboxRow> }) {
  const calls: { set?: Record<string, unknown>; where?: SQL } = {};
  const db = {
    update: () => ({
      set: (changes: Record<string, unknown>) => {
        calls.set = changes;
        return {
          where: (where: SQL) => {
            calls.where = where;
            return { returning: () => Promise.resolve(opts.updateMatches ? [row({ ...opts.existing, ...changes } as Partial<OutboxRow>)] : []) };
          },
        };
      },
    }),
    select: () => ({ from: () => ({ where: () => Promise.resolve(opts.existing ? [opts.existing] : []) }) }),
  };
  return { db: db as unknown as Db, calls };
}

const render = (where: SQL | undefined) => new PgDialect().sqlToQuery(where!);

describe('OutboxService', () => {
  let enqueue: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
  const make = (opts: Parameters<typeof fakeDb>[0]) => {
    const { db, calls } = fakeDb(opts);
    return { service: new OutboxService(db, { enqueue } as unknown as HaipQueue), calls };
  };

  beforeEach(() => {
    enqueue = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  describe('retry', () => {
    it('resets an ordinary needs_attention row to pending and queues it', async () => {
      const { service, calls } = make({ updateMatches: true, existing: row() });

      const result = await service.retry(OUTBOX_ID, PROPERTY_ID);

      expect(result.status).toBe('pending');
      expect(calls.set).toMatchObject({ status: 'pending', attempts: 0, lastError: null, nextRetryAt: null });
      expect(enqueue).toHaveBeenCalledExactlyOnceWith(OUTBOX_ID);
    });

    it('puts the no-in-house guard in the UPDATE itself (atomic, not check-then-act)', async () => {
      const { service, calls } = make({ updateMatches: true, existing: row() });
      await service.retry(OUTBOX_ID, PROPERTY_ID);

      const { sql, params } = render(calls.where);
      expect(sql).toContain('"haip_post_outbox"."last_error" is null or "haip_post_outbox"."last_error" not like');
      expect(params).toContain(`%${HAIP_NO_IN_HOUSE_TEXT}%`);
    });

    it.each([
      ['written by the processor now', NO_GUEST_ERROR],
      ['parked before the guard existed', `HAIP rejected (400): HTTP 400: Room 108 ${HAIP_NO_IN_HOUSE_TEXT}`],
    ])('refuses a row parked for no in-house guest (%s) with 409 and does not queue', async (_label, lastError) => {
      const { service } = make({ updateMatches: false, existing: { status: 'needs_attention', lastError } });

      const error = await service.retry(OUTBOX_ID, PROPERTY_ID).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toMatch(/resolve it here/);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('still says 400 (not 409) for a non-actionable row, even with that lastError', async () => {
      const { service } = make({ updateMatches: false, existing: { status: 'posted', lastError: NO_GUEST_ERROR } });
      await expect(service.retry(OUTBOX_ID, PROPERTY_ID)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404 when the row is not in this property', async () => {
      const { service } = make({ updateMatches: false });
      await expect(service.retry(OUTBOX_ID, PROPERTY_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a Redis failure while queueing does not fail the retry (sweeper picks it up)', async () => {
      enqueue.mockRejectedValue(new Error('ECONNREFUSED'));
      const { service } = make({ updateMatches: true, existing: row() });
      await expect(service.retry(OUTBOX_ID, PROPERTY_ID)).resolves.toMatchObject({ status: 'pending' });
    });
  });

  describe('resolve', () => {
    it('is allowed for a row parked for no in-house guest, and does not send anything', async () => {
      const { service, calls } = make({ updateMatches: true, existing: row({ lastError: NO_GUEST_ERROR }) });

      const result = await service.resolve(OUTBOX_ID, PROPERTY_ID, 'haip-charge-7');

      expect(result).toMatchObject({ status: 'posted', haipChargeId: 'haip-charge-7' });
      expect(calls.set!['postedAt']).toBeInstanceOf(Date);
      expect(render(calls.where).params).not.toContain(`%${HAIP_NO_IN_HOUSE_TEXT}%`);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('400 for a row that is not needs_attention or failed', async () => {
      const { service } = make({ updateMatches: false, existing: { status: 'pending', lastError: null } });
      await expect(service.resolve(OUTBOX_ID, PROPERTY_ID)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
