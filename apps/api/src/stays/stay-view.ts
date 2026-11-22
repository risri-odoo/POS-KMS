import type { RoomLookupResult, StayOccupant } from '../haip/stay-lookup.js';

/** What POS screens may see about a guest: first name and surname initial. Never more. */
export interface PublicGuest {
  firstName: string;
  lastInitial: string;
  /** e.g. "Ada L." */
  displayName: string;
}

export interface PublicStay {
  reservationId: string;
  roomNumber: string;
  departureDate: string;
  guests: PublicGuest[];
}

export type StayLookupResponse =
  | { status: 'found'; stays: PublicStay[] }
  | { status: 'none' }
  | { status: 'unavailable' }
  | { status: 'not_configured' };

/** Reduce an occupant to first name + initial, whatever the adapter returned. */
export function publicGuest(occupant: StayOccupant): PublicGuest {
  const firstName = String(occupant.firstName ?? '').trim().slice(0, 60);
  const lastInitial = String(occupant.lastInitial ?? '').trim().charAt(0).toUpperCase();
  return { firstName, lastInitial, displayName: lastInitial ? `${firstName} ${lastInitial}.` : firstName };
}

/**
 * Build the response field by field (an allow-list), so a future adapter that
 * returns more (full names, phone, email, folio ids) can't leak it to the screen.
 * The folio id stays server-side: orders get it from a fresh lookup.
 */
export function toStayLookupResponse(result: RoomLookupResult): StayLookupResponse {
  switch (result.kind) {
    case 'found':
      return {
        status: 'found',
        stays: result.stays.map((s) => ({
          reservationId: s.reservationId,
          roomNumber: s.roomNumber,
          departureDate: s.departureDate,
          guests: s.occupants.map(publicGuest).filter((g) => g.firstName !== ''),
        })),
      };
    case 'none':
      return { status: 'none' };
    case 'unavailable':
      return { status: 'unavailable' };
    case 'not_configured':
      return { status: 'not_configured' };
  }
}
