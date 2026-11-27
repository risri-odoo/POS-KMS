import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  HAIP_NO_IN_HOUSE_TEXT,
  NO_IN_HOUSE_GUEST_PREFIX,
  autoPostAllowed,
  isNoInHouseGuestError,
  isResolveOnly,
  manualRetryAllowed,
  reasonForRejection,
  resolveOnlyMessage,
} from './no-in-house-guard.js';

describe('isNoInHouseGuestError', () => {
  it('matches the lastError the processor writes now', () => {
    expect(
      isNoInHouseGuestError(`${NO_IN_HOUSE_GUEST_PREFIX}. HAIP rejected (400): HTTP 400: Room 110 ${HAIP_NO_IN_HOUSE_TEXT}`),
    ).toBe(true);
  });

  it('matches rows parked before the prefix existed (live-run wording)', () => {
    expect(isNoInHouseGuestError('HAIP rejected (400): HTTP 400: Room 108 is vacant or has no in-house reservation')).toBe(true);
  });

  it.each([
    null,
    undefined,
    '',
    'HAIP rejected (400): HTTP 400: Room 999 not found in this property',
    'HAIP rejected (401): HTTP 401: Invalid or missing API key',
    'May already be posted in HAIP, verify the folio before retrying. Last error: HTTP 500: Internal server error',
    'No HAIP key configured for this property',
  ])('does not match %j', (lastError) => {
    expect(isNoInHouseGuestError(lastError)).toBe(false);
  });
});

describe('autoPostAllowed (sweeper)', () => {
  it('only lets rows with no parked reason through', () => {
    const { sql, params } = new PgDialect().sqlToQuery(autoPostAllowed());
    expect(sql).toBe('"haip_post_outbox"."parked_reason" is null');
    expect(params).toEqual([]);
  });
});

describe('manualRetryAllowed (Retry)', () => {
  it('lets rows with no reason or haip_rejected through', () => {
    const { sql, params } = new PgDialect().sqlToQuery(manualRetryAllowed());
    // NULL must be explicit: `NULL = x` is NULL, which would drop rows with no reason.
    expect(sql).toBe('("haip_post_outbox"."parked_reason" is null or "haip_post_outbox"."parked_reason" = $1)');
    expect(params).toEqual(['haip_rejected']);
  });

  it('also lets "Hotel not set up" through once the hotel’s key is set (a person’s Retry only)', () => {
    const { sql, params } = new PgDialect().sqlToQuery(manualRetryAllowed(true));
    expect(sql).toBe('("haip_post_outbox"."parked_reason" is null or "haip_post_outbox"."parked_reason" = $1 or "haip_post_outbox"."parked_reason" = $2)');
    expect(params).toEqual(['haip_rejected', 'wrong_property']);
  });
});

describe('isResolveOnly', () => {
  it.each(['no_in_house_guest', 'stay_ended', 'needs_verification', 'wrong_property'] as const)('%s is resolve-only', (reason) => {
    expect(isResolveOnly(reason)).toBe(true);
  });

  it.each([null, undefined, 'haip_rejected'] as const)('%j is not resolve-only', (reason) => {
    expect(isResolveOnly(reason)).toBe(false);
  });

  it('"Hotel not set up" stops being resolve-only once the hotel’s key is set; the others never do', () => {
    expect(isResolveOnly('wrong_property', true)).toBe(false);
    for (const reason of ['no_in_house_guest', 'stay_ended', 'needs_verification'] as const) expect(isResolveOnly(reason, true)).toBe(true);
  });
});

describe('reasonForRejection', () => {
  it('maps HAIP’s no-in-house text to no_in_house_guest', () => {
    expect(reasonForRejection(`HTTP 400: Room 110 ${HAIP_NO_IN_HOUSE_TEXT}`)).toBe('no_in_house_guest');
  });

  it('maps any other rejection to haip_rejected', () => {
    expect(reasonForRejection('HTTP 422: amount must be positive')).toBe('haip_rejected');
    expect(reasonForRejection('HTTP 400: Room 999 not found in this property')).toBe('haip_rejected');
  });
});

describe('resolveOnlyMessage', () => {
  it('names the reason and tells staff to resolve in HAIP', () => {
    expect(resolveOnlyMessage('stay_ended')).toMatch(/stay had ended.*resolve it here/);
    expect(resolveOnlyMessage('no_in_house_guest')).toMatch(/no in-house guest.*resolve it here/);
  });
});
