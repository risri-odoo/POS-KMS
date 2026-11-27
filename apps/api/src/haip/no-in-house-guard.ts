import { eq, isNull, or, type SQL } from 'drizzle-orm';
import { haipPostOutbox, type parkedReason } from '@stayx/database';

export type ParkedReason = (typeof parkedReason.enumValues)[number];

/**
 * HAIP folio-inbound's 400 text when the room has no in-house reservation
 * (haip folio-inbound.service.ts). Read only to classify HAIP's answer, and as a
 * safety net for rows reset to pending by hand before parked_reason existed.
 */
export const HAIP_NO_IN_HOUSE_TEXT = 'is vacant or has no in-house reservation';

export const NO_IN_HOUSE_GUEST_PREFIX =
  'Room had no in-house guest when this was posted. It will not be re-sent: HAIP posts by room number, ' +
  'so a re-post could charge whoever is in the room now. Post it to the right folio in HAIP, then resolve it here';

export function isNoInHouseGuestError(text: string | null | undefined): boolean {
  return text?.includes(HAIP_NO_IN_HOUSE_TEXT) ?? false;
}

/**
 * Parked for a reason staff must fix in HAIP, then use Resolve. Never re-sent by
 * Retry or the sweeper: HAIP posts by room number, so a re-post could charge
 * whoever is in the room now (confirmed live, AUDIT.md §9 S6c).
 */
export const RESOLVE_ONLY_REASONS: readonly ParkedReason[] = [
  'no_in_house_guest',
  'stay_ended',
  'needs_verification',
  'wrong_property',
];

export function isResolveOnly(reason: ParkedReason | null | undefined): boolean {
  return reason != null && RESOLVE_ONLY_REASONS.includes(reason);
}

/** Why HAIP rejected a post (a 4xx). */
export function reasonForRejection(message: string): ParkedReason {
  return isNoInHouseGuestError(message) ? 'no_in_house_guest' : 'haip_rejected';
}

/** The sweeper and the processor only send rows with no parked reason at all. */
export function autoPostAllowed(): SQL {
  return isNull(haipPostOutbox.parkedReason);
}

/** Staff may press Retry on rows with no reason, or rejected for bad data (haip_rejected). */
export function manualRetryAllowed(): SQL {
  return or(isNull(haipPostOutbox.parkedReason), eq(haipPostOutbox.parkedReason, 'haip_rejected'))!;
}

/** The 409 message for Retry on a resolve-only row. */
export function resolveOnlyMessage(reason: ParkedReason): string {
  const why: Record<ParkedReason, string> = {
    no_in_house_guest: 'the room had no in-house guest',
    stay_ended: "the guest's stay had ended before it could be posted",
    needs_verification: 'it could not be matched to a single in-house stay',
    wrong_property: 'this hotel is not set up for HAIP posting (no active hotel or no usable HAIP key)',
    haip_rejected: 'HAIP rejected it',
  };
  return (
    `This charge was parked because ${why[reason]}. Re-sending it could charge the wrong guest, so it cannot be ` +
    'retried. Post it to the right guest folio in HAIP, then resolve it here.'
  );
}
