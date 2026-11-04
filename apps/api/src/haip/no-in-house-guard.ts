import { isNull, notLike, or, type SQL } from 'drizzle-orm';
import { haipPostOutbox } from '@stayx/database';

/**
 * HAIP folio-inbound's 400 text when the room has no in-house reservation
 * (haip folio-inbound.service.ts). Every POS lastError for this case contains it,
 * including rows parked before NO_IN_HOUSE_GUEST_PREFIX existed.
 */
export const HAIP_NO_IN_HOUSE_TEXT = 'is vacant or has no in-house reservation';

export const NO_IN_HOUSE_GUEST_PREFIX =
  'Room had no in-house guest when this was posted. It will not be re-sent: HAIP posts by room number, ' +
  'so a re-post could charge whoever is in the room now. Post it to the right folio in HAIP, then resolve it here';

/**
 * Why: HAIP picks the folio by room number at post time. Once the guest has
 * checked out or moved, re-posting the same charge lands on the room's next
 * occupant (confirmed live, AUDIT.md §9 S6c). These rows are resolve-only.
 */
export function isNoInHouseGuestError(lastError: string | null | undefined): boolean {
  return lastError?.includes(HAIP_NO_IN_HOUSE_TEXT) ?? false;
}

/** SQL twin of !isNoInHouseGuestError(lastError): the row may be (re)posted. */
export function repostAllowed(): SQL {
  return or(isNull(haipPostOutbox.lastError), notLike(haipPostOutbox.lastError, `%${HAIP_NO_IN_HOUSE_TEXT}%`))!;
}
