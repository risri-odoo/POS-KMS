import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { OutboxService, type OutboxRow } from './outbox.service.js';
import type { AuthPrincipal } from '../auth/token-verifier.js';
import type { PropertyDirectory } from '../properties/properties.service.js';
import type { OutboxAlerts } from '../events/outbox-alerts.service.js';
import type { HaipQueue } from '../haip/haip-queue.service.js';
import type { Db } from '../database/database.module.js';
import { HAIP_NO_IN_HOUSE_TEXT, NO_IN_HOUSE_GUEST_PREFIX } from '../haip/no-in-house-guard.js';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const OUTBOX_ID = '55555555-5555-4555-8555-555555555555';
const MANAGER: AuthPrincipal = { sub: 'm1', username: 'pos-manager-1', roles: ['pos_manager'], propertyIds: [PROPERTY_ID], azp: 'stayx-pos-web', expiresAt: 0 };
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
    resolutionType: null,
    resolutionNote: null,
    resolvedBy: null,
    resolvedAt: null,
    lastRetryBy: null,
    lastRetryAt: null,
    lastRetryNote: null,
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
  const alerts = { refresh: vi.fn().mockResolvedValue(undefined), stuckCutoff: () => null };
  /** The rows' hotel; its key variable is HAIP_KEY_OUTBOXTEST, set or not per test. */
  const hotel: PropertyDirectory = {
    find: () => Promise.resolve({ id: PROPERTY_ID, name: 'Demo hotel', haipApiKeyEnv: 'HAIP_KEY_OUTBOXTEST', active: true } as never),
  };
  const make = (opts: Parameters<typeof fakeDb>[0]) => {
    const { db, calls } = fakeDb(opts);
    return { service: new OutboxService(db, { enqueue } as unknown as HaipQueue, hotel, alerts as unknown as OutboxAlerts), calls };
  };

  beforeEach(() => {
    delete process.env['HAIP_KEY_OUTBOXTEST'];
    enqueue = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  describe('retry', () => {
    it('resets an ordinary needs_attention row to pending and queues it', async () => {
      const { service, calls } = make({ updateMatches: true, existing: row() });

      const result = await service.retry(OUTBOX_ID, PROPERTY_ID);

      expect(result.status).toBe('pending');
      expect(calls.set).toMatchObject({ status: 'pending', attempts: 0, lastError: null, nextRetryAt: null, parkedReason: null });
      expect(enqueue).toHaveBeenCalledExactlyOnceWith(OUTBOX_ID);
    });

    it('allows a haip_rejected row (bad data, fixed by staff) and clears its parked reason', async () => {
      const { service, calls } = make({ updateMatches: true, existing: row({ parkedReason: 'haip_rejected' }) });

      const result = await service.retry(OUTBOX_ID, PROPERTY_ID);

      expect(calls.set).toMatchObject({ status: 'pending', parkedReason: null });
      expect(result.parkedReason).toBeNull();
      expect(enqueue).toHaveBeenCalledExactlyOnceWith(OUTBOX_ID);
    });

    it('puts the parked-reason guard in the UPDATE itself (atomic, not check-then-act)', async () => {
      const { service, calls } = make({ updateMatches: true, existing: row() });
      await service.retry(OUTBOX_ID, PROPERTY_ID);

      const { sql, params } = render(calls.where);
      expect(sql).toContain('("haip_post_outbox"."parked_reason" is null or "haip_post_outbox"."parked_reason" = $');
      expect(params).toContain('haip_rejected');
      expect(sql).not.toContain('last_error');
    });

    it('"Hotel not set up": 409 "Add the hotel’s HAIP key first" while the key is missing', async () => {
      const { service, calls } = make({ updateMatches: false, existing: { status: 'needs_attention', parkedReason: 'wrong_property' } });
      const error = await service.retry(OUTBOX_ID, PROPERTY_ID).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toContain("Add the hotel's HAIP key first");
      expect(render(calls.where).params).not.toContain('wrong_property');
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('"Hotel not set up": once the key is set, a person may retry; the reason is cleared and it is queued', async () => {
      process.env['HAIP_KEY_OUTBOXTEST'] = 'k';
      const { service, calls } = make({ updateMatches: true, existing: row({ parkedReason: 'wrong_property' }) });
      await expect(service.retry(OUTBOX_ID, PROPERTY_ID)).resolves.toMatchObject({ status: 'pending', parkedReason: null });
      expect(render(calls.where).params).toContain('wrong_property');
      expect(enqueue).toHaveBeenCalledExactlyOnceWith(OUTBOX_ID);
    });

    it.each(['no_in_house_guest', 'stay_ended', 'needs_verification'] as const)(
      'refuses a row parked as %s with 409 and does not queue, key or not',
      async (parkedReason) => {
        const { service } = make({ updateMatches: false, existing: { status: 'needs_attention', parkedReason } });

        const error = await service.retry(OUTBOX_ID, PROPERTY_ID).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).message).toMatch(/resolve it here/);
        expect(enqueue).not.toHaveBeenCalled();
      },
    );

    it('still says 400 (not 409) for a non-actionable row, even with a resolve-only reason', async () => {
      const { service } = make({ updateMatches: false, existing: { status: 'posted', parkedReason: 'no_in_house_guest' } });
      await expect(service.retry(OUTBOX_ID, PROPERTY_ID)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404 when the row is not in this property', async () => {
      const { service } = make({ updateMatches: false });
      await expect(service.retry(OUTBOX_ID, PROPERTY_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('recounts the hotel’s alerts after a retry', async () => {
      alerts.refresh.mockClear();
      const { service } = make({ updateMatches: true, existing: row() });
      await service.retry(OUTBOX_ID, PROPERTY_ID);
      expect(alerts.refresh).toHaveBeenCalledWith(PROPERTY_ID);
    });

    it('records who retried, when, and the optional note', async () => {
      const { service, calls } = make({ updateMatches: true, existing: row() });
      await service.retry(OUTBOX_ID, PROPERTY_ID, { note: 'Guest fixed at desk' }, MANAGER);
      expect(calls.set).toMatchObject({ lastRetryBy: 'pos-manager-1', lastRetryNote: 'Guest fixed at desk' });
      expect(calls.set!['lastRetryAt']).toBeInstanceOf(Date);
    });

    it('with login off and no note: no name, no note, still recorded as retried', async () => {
      const { service, calls } = make({ updateMatches: true, existing: row() });
      await service.retry(OUTBOX_ID, PROPERTY_ID);
      expect(calls.set).toMatchObject({ lastRetryBy: null, lastRetryNote: null });
      expect(calls.set!['lastRetryAt']).toBeInstanceOf(Date);
    });

    it('a Redis failure while queueing does not fail the retry (sweeper picks it up)', async () => {
      enqueue.mockRejectedValue(new Error('ECONNREFUSED'));
      const { service } = make({ updateMatches: true, existing: row() });
      await expect(service.retry(OUTBOX_ID, PROPERTY_ID)).resolves.toMatchObject({ status: 'pending' });
    });
  });

  describe('resolve', () => {
    it('posted_manually: posted, with the charge id, type, note and who; sends nothing; keeps the reason', async () => {
      const { service, calls } = make({
        updateMatches: true,
        existing: row({ lastError: NO_GUEST_ERROR, parkedReason: 'no_in_house_guest' }),
      });

      const result = await service.resolve(
        OUTBOX_ID,
        PROPERTY_ID,
        { resolutionType: 'posted_manually', note: 'Added to folio by front desk', haipChargeId: 'haip-charge-7' },
        MANAGER,
      );

      expect(result).toMatchObject({
        status: 'posted',
        haipChargeId: 'haip-charge-7',
        parkedReason: 'no_in_house_guest',
        resolutionType: 'posted_manually',
        resolutionNote: 'Added to folio by front desk',
        resolvedBy: 'pos-manager-1',
      });
      expect(calls.set!['postedAt']).toBeInstanceOf(Date);
      expect(calls.set!['resolvedAt']).toBeInstanceOf(Date);
      expect(calls.set).not.toHaveProperty('parkedReason');
      expect(render(calls.where).sql).not.toContain('parked_reason');
      expect(enqueue).not.toHaveBeenCalled();
    });

    it.each(['collected_otherwise', 'written_off', 'duplicate_or_error'] as const)(
      '%s: resolved, never posted, no posted time',
      async (resolutionType) => {
        const { service, calls } = make({ updateMatches: true, existing: row({ parkedReason: 'stay_ended' }) });

        const result = await service.resolve(OUTBOX_ID, PROPERTY_ID, { resolutionType, note: 'Paid at the front desk' }, MANAGER);

        expect(result).toMatchObject({ status: 'resolved', resolutionType, resolutionNote: 'Paid at the front desk', resolvedBy: 'pos-manager-1' });
        expect(calls.set).not.toHaveProperty('postedAt');
        expect(calls.set).not.toHaveProperty('haipChargeId');
        expect(enqueue).not.toHaveBeenCalled();
      },
    );

    it('400 for a HAIP charge id with any type but posted_manually, before touching the row', async () => {
      const { service, calls } = make({ updateMatches: true, existing: row() });
      await expect(
        service.resolve(OUTBOX_ID, PROPERTY_ID, { resolutionType: 'written_off', note: 'Comped', haipChargeId: 'c-1' }),
      ).rejects.toThrow('only allowed with resolutionType posted_manually');
      expect(calls.set).toBeUndefined();
    });

    it('400 for a row that is not needs_attention or failed', async () => {
      const { service } = make({ updateMatches: false, existing: { status: 'pending', lastError: null } });
      await expect(service.resolve(OUTBOX_ID, PROPERTY_ID, { resolutionType: 'written_off', note: 'Comped' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('404 when the row is not in this property', async () => {
      const { service } = make({ updateMatches: false });
      await expect(service.resolve(OUTBOX_ID, PROPERTY_ID, { resolutionType: 'written_off', note: 'Comped' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
