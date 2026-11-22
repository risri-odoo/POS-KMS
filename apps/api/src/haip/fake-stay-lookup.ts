import {
  isInHouseStatus,
  type InHouseStay,
  type RoomLookupResult,
  type StayLookup,
  type StayLookupResult,
  type StayOccupant,
} from './stay-lookup.js';

/** A stay as the fake holds it. Names are already reduced to first name + initial. */
export interface FakeStay {
  propertyId: string;
  reservationId: string;
  status: string;
  roomNumber: string | null;
  departureDate: string;
  guestFolioId: string | null;
  occupants: StayOccupant[];
}

const DEMO_PROPERTY = 'a0000001-0000-4000-a000-000000000001';

/**
 * Made-up stays for local development with HAIP_STAY_LOOKUP=fake. Not HAIP data.
 * Room 102 deliberately has two in-house stays, to exercise the ambiguous path.
 */
export function demoStays(): FakeStay[] {
  const stay = (n: number, room: string, first: string, initial: string, status = 'checked_in'): FakeStay => ({
    propertyId: DEMO_PROPERTY,
    reservationId: `f0000000-0000-4000-a000-00000000000${n}`,
    status,
    roomNumber: room,
    departureDate: '2099-12-31',
    guestFolioId: `f1000000-0000-4000-a000-00000000000${n}`,
    occupants: [{ firstName: first, lastInitial: initial }],
  });
  return [
    stay(1, '101', 'Ada', 'L'),
    stay(2, '102', 'Grace', 'H'),
    stay(3, '102', 'Alan', 'T'),
    stay(4, '103', 'Edsger', 'D', 'checked_out'),
  ];
}

/**
 * In-memory StayLookup for tests and local development. Refused in production
 * (stay-lookup.config.ts). Returns copies, so callers can't change its state.
 */
export class FakeStayLookup implements StayLookup {
  private readonly stays = new Map<string, FakeStay>();
  private unavailableReason: string | null = null;

  constructor(stays: FakeStay[] = []) {
    for (const s of stays) this.put(s);
  }

  /** Add or replace a stay. */
  put(stay: FakeStay): void {
    this.stays.set(stay.reservationId, structuredClone(stay));
  }

  /** Simulate HAIP being down (or recovering, with null). */
  setUnavailable(reason: string | null): void {
    this.unavailableReason = reason;
  }

  /** Simulate a checkout. */
  checkOut(reservationId: string): void {
    const s = this.stays.get(reservationId);
    if (s) s.status = 'checked_out';
  }

  /** Simulate a room move. */
  moveRoom(reservationId: string, roomNumber: string): void {
    const s = this.stays.get(reservationId);
    if (s) s.roomNumber = roomNumber;
  }

  async findInHouseByRoom(propertyId: string, roomNumber: string): Promise<RoomLookupResult> {
    if (this.unavailableReason) return { kind: 'unavailable', reason: this.unavailableReason };
    const room = roomNumber.trim();
    const stays: InHouseStay[] = [...this.stays.values()]
      .filter((s) => s.propertyId === propertyId && s.roomNumber === room && isInHouseStatus(s.status))
      .map((s) => ({
        reservationId: s.reservationId,
        roomNumber: room,
        departureDate: s.departureDate,
        guestFolioId: s.guestFolioId,
        occupants: s.occupants.map((o) => ({ ...o })),
      }));
    return stays.length > 0 ? { kind: 'found', stays } : { kind: 'none' };
  }

  async getStay(propertyId: string, reservationId: string): Promise<StayLookupResult> {
    if (this.unavailableReason) return { kind: 'unavailable', reason: this.unavailableReason };
    const s = this.stays.get(reservationId);
    if (!s || s.propertyId !== propertyId) return { kind: 'not_found' };
    return {
      kind: 'found',
      stay: {
        reservationId: s.reservationId,
        status: s.status,
        inHouse: isInHouseStatus(s.status),
        roomNumber: s.roomNumber,
        departureDate: s.departureDate,
        guestFolioId: s.guestFolioId,
      },
    };
  }
}
