import type { StayLookup } from './stay-lookup.js';

/**
 * How long after delivery the worker keeps waiting for an unavailable stay lookup
 * before it gives up and parks the charge for a person (needs_verification).
 */
export const STAY_LOOKUP_MAX_WAIT_MS = 6 * 60 * 60 * 1000;

/** How long to wait before asking an unavailable lookup again. Nothing is sent meanwhile. */
export const STAY_LOOKUP_RETRY_DELAY_MS = 5 * 60 * 1000;

export interface PostingInput {
  propertyId: string;
  /** The room on the order (delivery room). */
  orderRoom: string;
  /** Null for orders placed before Phase 1. */
  verificationStatus: 'verified' | 'unverified' | null;
  /** From the outbox row, else the order. */
  reservationId: string | null;
  folioId: string | null;
  /** When the order was delivered; the max wait is measured from here. */
  deliveredAt: Date;
}

export type PostingDecision =
  /** Today's path: folio-inbound by the order's room, with the existing guard. */
  | { kind: 'post_by_room'; roomNumber: string }
  /** The stay was re-checked: post by its current room, the only in-house stay there. */
  | { kind: 'post_to_stay'; roomNumber: string; reservationId: string; folioId: string | null; matchedAtPosting: boolean }
  /** Don't send; a person must post it in HAIP and resolve it. */
  | { kind: 'park'; reason: 'stay_ended' | 'needs_verification'; message: string }
  /** The lookup is unavailable: send nothing, ask again at `retryAt`. */
  | { kind: 'defer'; reason: string; retryAt: Date };

const NOTHING_SENT = 'Nothing was sent. Post it to the right guest folio in HAIP, then resolve it here.';

/**
 * Re-check the stay before every post attempt (INTEGRATION_DESIGN.md §4.8).
 * Folio-inbound posts by room number, so we only send when the bound stay is
 * still in-house and is the only in-house stay in its current room.
 *
 * - HAIP_STAY_LOOKUP unset (not_configured), or an order from before Phase 1:
 *   today's path, post by the order's room.
 * - Bound stay: ended → stay_ended; shared room → needs_verification; moved → post by the new room.
 * - Unverified order: exactly one in-house stay in its room → attach it (matched at posting) and post;
 *   otherwise needs_verification.
 * - Lookup unavailable: defer, until STAY_LOOKUP_MAX_WAIT_MS after delivery, then needs_verification.
 */
export async function decidePosting(lookup: StayLookup, input: PostingInput, now: Date = new Date()): Promise<PostingDecision> {
  const byRoom: PostingDecision = { kind: 'post_by_room', roomNumber: input.orderRoom };
  const waitOrPark = (reason: string): PostingDecision =>
    now.getTime() - input.deliveredAt.getTime() >= STAY_LOOKUP_MAX_WAIT_MS
      ? {
          kind: 'park',
          reason: 'needs_verification',
          message: `The stay lookup was unavailable for more than ${STAY_LOOKUP_MAX_WAIT_MS / 3_600_000} hours after delivery (${reason}). ${NOTHING_SENT}`,
        }
      : { kind: 'defer', reason, retryAt: new Date(now.getTime() + STAY_LOOKUP_RETRY_DELAY_MS) };

  // Placed before Phase 1: no stay to check against.
  if (input.verificationStatus === null && !input.reservationId) return byRoom;

  if (input.reservationId) {
    const stayResult = await lookup.getStay(input.propertyId, input.reservationId);
    if (stayResult.kind === 'not_configured') return byRoom;
    if (stayResult.kind === 'unavailable') return waitOrPark(stayResult.reason);
    if (stayResult.kind === 'not_found' || !stayResult.stay.inHouse) {
      const status = stayResult.kind === 'found' ? ` (HAIP status: ${stayResult.stay.status})` : '';
      return { kind: 'park', reason: 'stay_ended', message: `The guest's stay ended before this was posted${status}. ${NOTHING_SENT}` };
    }
    const room = stayResult.stay.roomNumber;
    if (!room) {
      return { kind: 'park', reason: 'needs_verification', message: `The guest's stay has no room assigned in HAIP. ${NOTHING_SENT}` };
    }

    const roomResult = await lookup.findInHouseByRoom(input.propertyId, room);
    if (roomResult.kind === 'not_configured') return byRoom;
    if (roomResult.kind === 'unavailable') return waitOrPark(roomResult.reason);
    if (roomResult.kind === 'none' || roomResult.stays.length !== 1 || roomResult.stays[0]!.reservationId !== input.reservationId) {
      return {
        kind: 'park',
        reason: 'needs_verification',
        message: `Room ${room} has more than one in-house stay, so HAIP can't be told which guest to charge. ${NOTHING_SENT}`,
      };
    }
    return {
      kind: 'post_to_stay',
      roomNumber: room,
      reservationId: input.reservationId,
      folioId: stayResult.stay.guestFolioId ?? input.folioId,
      matchedAtPosting: false,
    };
  }

  // Unverified order: try to match it now.
  const roomResult = await lookup.findInHouseByRoom(input.propertyId, input.orderRoom);
  if (roomResult.kind === 'not_configured') return byRoom;
  if (roomResult.kind === 'unavailable') return waitOrPark(roomResult.reason);
  if (roomResult.kind === 'none') {
    return {
      kind: 'park',
      reason: 'needs_verification',
      message: `Unverified order: HAIP shows no in-house guest in room ${input.orderRoom}, so it couldn't be matched to a stay. ${NOTHING_SENT}`,
    };
  }
  if (roomResult.stays.length !== 1) {
    return {
      kind: 'park',
      reason: 'needs_verification',
      message: `Unverified order: room ${input.orderRoom} has more than one in-house stay, so it couldn't be matched to one guest. ${NOTHING_SENT}`,
    };
  }
  const stay = roomResult.stays[0]!;
  return { kind: 'post_to_stay', roomNumber: input.orderRoom, reservationId: stay.reservationId, folioId: stay.guestFolioId, matchedAtPosting: true };
}
