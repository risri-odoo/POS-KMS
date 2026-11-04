import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { HAIP_NO_IN_HOUSE_TEXT, NO_IN_HOUSE_GUEST_PREFIX, isNoInHouseGuestError, repostAllowed } from './no-in-house-guard.js';

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

describe('repostAllowed', () => {
  it('lets NULL lastError through and excludes the no-in-house text', () => {
    const { sql, params } = new PgDialect().sqlToQuery(repostAllowed());
    // NULL must be explicit: `NULL NOT LIKE x` is NULL, which would drop clean rows.
    expect(sql).toBe('("haip_post_outbox"."last_error" is null or "haip_post_outbox"."last_error" not like $1)');
    expect(params).toEqual([`%${HAIP_NO_IN_HOUSE_TEXT}%`]);
  });
});
