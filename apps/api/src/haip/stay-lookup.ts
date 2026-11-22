/**
 * Read-only view of HAIP stays, used to bind an order to the guest's stay
 * (INTEGRATION_DESIGN.md §4). HAIP owns guests and stays: this interface only
 * returns what POS needs to bind and re-check an order. Never a phone number,
 * email or full surname.
 */
export const STAY_LOOKUP = Symbol('STAY_LOOKUP');

/** A named guest on a stay, reduced to what staff need to confirm "is this you?". */
export interface StayOccupant {
  firstName: string;
  /** First letter of the surname, e.g. "L". Empty when HAIP has no surname. */
  lastInitial: string;
}

/** An in-house stay (HAIP status checked_in, stayover or due_out) found by room. */
export interface InHouseStay {
  reservationId: string;
  roomNumber: string;
  /** YYYY-MM-DD */
  departureDate: string;
  /** The stay's open guest folio, or null when HAIP has none open. */
  guestFolioId: string | null;
  /** Primary guest first, then accompanying guests. */
  occupants: StayOccupant[];
}

/** Current state of one stay, for re-checking before an order or a post. */
export interface StayStatus {
  reservationId: string;
  /** HAIP reservation status, e.g. checked_in, checked_out. */
  status: string;
  /** True for checked_in, stayover and due_out. */
  inHouse: boolean;
  /** The room the stay is in now (follows room moves), or null if unassigned. */
  roomNumber: string | null;
  /** YYYY-MM-DD */
  departureDate: string;
  guestFolioId: string | null;
}

/** HAIP couldn't be asked (network, timeout, 5xx, auth). Nothing about the stay is known. */
export interface LookupUnavailable {
  kind: 'unavailable';
  reason: string;
}

/** No stay lookup is configured (HAIP_STAY_LOOKUP unset): orders go through the unverified flow. */
export interface LookupNotConfigured {
  kind: 'not_configured';
}

export type RoomLookupResult =
  /** One or more in-house stays. More than one means the room is ambiguous. */
  | { kind: 'found'; stays: InHouseStay[] }
  | { kind: 'none' }
  | LookupUnavailable
  | LookupNotConfigured;

export type StayLookupResult =
  | { kind: 'found'; stay: StayStatus }
  | { kind: 'not_found' }
  | LookupUnavailable
  | LookupNotConfigured;

export interface StayLookup {
  /** In-house stays for a room number at a property. Never throws. */
  findInHouseByRoom(propertyId: string, roomNumber: string): Promise<RoomLookupResult>;
  /** One stay by HAIP reservation id. Never throws. */
  getStay(propertyId: string, reservationId: string): Promise<StayLookupResult>;
}

export const IN_HOUSE_STATUSES: readonly string[] = ['checked_in', 'stayover', 'due_out'];

export function isInHouseStatus(status: string): boolean {
  return IN_HOUSE_STATUSES.includes(status);
}

/** Used when HAIP_STAY_LOOKUP is unset. Every call answers "not configured". */
export class NotConfiguredStayLookup implements StayLookup {
  async findInHouseByRoom(): Promise<RoomLookupResult> {
    return { kind: 'not_configured' };
  }

  async getStay(): Promise<StayLookupResult> {
    return { kind: 'not_configured' };
  }
}
