import { describe, expect, it } from 'vitest';
import { FakeStayLookup, type FakeStay } from './fake-stay-lookup.js';
import { NotConfiguredStayLookup } from './stay-lookup.js';
import { STAY_LOOKUP_MAX_WAIT_MS, STAY_LOOKUP_RETRY_DELAY_MS, decidePosting, type PostingInput } from './stay-recheck.js';

const PROPERTY = 'a0000001-0000-4000-a000-000000000001';
const RES = 'f0000000-0000-4000-a000-000000000001';
const NOW = new Date('2026-11-23T12:00:00Z');

const stay = (overrides: Partial<FakeStay> = {}): FakeStay => ({
  propertyId: PROPERTY,
  reservationId: RES,
  status: 'checked_in',
  roomNumber: '101',
  departureDate: '2026-12-01',
  guestFolioId: 'folio-1',
  occupants: [{ firstName: 'Ada', lastInitial: 'L' }],
  ...overrides,
});
const bound: PostingInput = {
  propertyId: PROPERTY,
  orderRoom: '101',
  verificationStatus: 'verified',
  reservationId: RES,
  folioId: 'folio-1',
  deliveredAt: new Date(NOW.getTime() - 60_000),
};
const unverified: PostingInput = { ...bound, verificationStatus: 'unverified', reservationId: null, folioId: null };

describe('decidePosting', () => {
  it('not configured: post by the order’s room, for bound and unverified orders', async () => {
    const lookup = new NotConfiguredStayLookup();
    await expect(decidePosting(lookup, bound, NOW)).resolves.toEqual({ kind: 'post_by_room', roomNumber: '101' });
    await expect(decidePosting(lookup, unverified, NOW)).resolves.toEqual({ kind: 'post_by_room', roomNumber: '101' });
  });

  it('orders from before Phase 1 post by room without asking the lookup', async () => {
    const lookup = new FakeStayLookup();
    lookup.setUnavailable('would defer if asked');
    await expect(decidePosting(lookup, { ...unverified, verificationStatus: null }, NOW)).resolves.toEqual({ kind: 'post_by_room', roomNumber: '101' });
  });

  it('bound stay in-house and alone: post to it', async () => {
    await expect(decidePosting(new FakeStayLookup([stay()]), bound, NOW)).resolves.toEqual({
      kind: 'post_to_stay',
      roomNumber: '101',
      reservationId: RES,
      folioId: 'folio-1',
      matchedAtPosting: false,
    });
  });

  it('room move: post by the new room', async () => {
    const decision = await decidePosting(new FakeStayLookup([stay({ roomNumber: '305' })]), bound, NOW);
    expect(decision).toMatchObject({ kind: 'post_to_stay', roomNumber: '305' });
  });

  it.each(['checked_out', 'cancelled', 'no_show'])('stay %s: stay_ended', async (status) => {
    await expect(decidePosting(new FakeStayLookup([stay({ status })]), bound, NOW)).resolves.toMatchObject({ kind: 'park', reason: 'stay_ended' });
  });

  it('stay not found: stay_ended', async () => {
    await expect(decidePosting(new FakeStayLookup([]), bound, NOW)).resolves.toMatchObject({ kind: 'park', reason: 'stay_ended' });
  });

  it('in-house but no room assigned: needs_verification', async () => {
    await expect(decidePosting(new FakeStayLookup([stay({ roomNumber: null })]), bound, NOW)).resolves.toMatchObject({
      kind: 'park',
      reason: 'needs_verification',
    });
  });

  it('bound stay sharing its room with another in-house stay: needs_verification', async () => {
    const lookup = new FakeStayLookup([stay(), stay({ reservationId: 'other' })]);
    await expect(decidePosting(lookup, bound, NOW)).resolves.toMatchObject({ kind: 'park', reason: 'needs_verification' });
  });

  it('lookup unavailable: defer and ask again after the retry delay', async () => {
    const lookup = new FakeStayLookup([stay()]);
    lookup.setUnavailable('HTTP 503');
    await expect(decidePosting(lookup, bound, NOW)).resolves.toEqual({
      kind: 'defer',
      reason: 'HTTP 503',
      retryAt: new Date(NOW.getTime() + STAY_LOOKUP_RETRY_DELAY_MS),
    });
  });

  it('lookup unavailable at exactly the max wait after delivery: park as needs_verification', async () => {
    const lookup = new FakeStayLookup([stay()]);
    lookup.setUnavailable('HTTP 503');
    const old = { ...bound, deliveredAt: new Date(NOW.getTime() - STAY_LOOKUP_MAX_WAIT_MS) };
    const decision = await decidePosting(lookup, old, NOW);
    expect(decision).toMatchObject({ kind: 'park', reason: 'needs_verification' });
    expect(decision.kind === 'park' && decision.message).toMatch(/unavailable for more than 6 hours/);
  });

  it('the max wait is 6 hours', () => {
    expect(STAY_LOOKUP_MAX_WAIT_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('unverified with one in-house stay: match it at posting', async () => {
    await expect(decidePosting(new FakeStayLookup([stay()]), unverified, NOW)).resolves.toEqual({
      kind: 'post_to_stay',
      roomNumber: '101',
      reservationId: RES,
      folioId: 'folio-1',
      matchedAtPosting: true,
    });
  });

  it('unverified with no in-house stay or two: needs_verification', async () => {
    await expect(decidePosting(new FakeStayLookup([]), unverified, NOW)).resolves.toMatchObject({ kind: 'park', reason: 'needs_verification' });
    const two = new FakeStayLookup([stay(), stay({ reservationId: 'other' })]);
    await expect(decidePosting(two, unverified, NOW)).resolves.toMatchObject({ kind: 'park', reason: 'needs_verification' });
  });

  it('unverified with the lookup unavailable: defer, then park after the max wait', async () => {
    const lookup = new FakeStayLookup([stay()]);
    lookup.setUnavailable('timeout');
    await expect(decidePosting(lookup, unverified, NOW)).resolves.toMatchObject({ kind: 'defer' });
    const old = { ...unverified, deliveredAt: new Date(NOW.getTime() - STAY_LOOKUP_MAX_WAIT_MS - 1) };
    await expect(decidePosting(lookup, old, NOW)).resolves.toMatchObject({ kind: 'park', reason: 'needs_verification' });
  });
});
