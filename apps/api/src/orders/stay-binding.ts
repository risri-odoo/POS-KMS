import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { StayLookup } from '../haip/stay-lookup.js';
import { publicGuest } from '../stays/stay-view.js';

/** The stay columns written on a new order. */
export interface StayBinding {
  haipReservationId: string | null;
  haipFolioId: string | null;
  verificationStatus: 'verified' | 'unverified';
  verifiedGuestName: string | null;
  verifiedAt: Date | null;
}

export interface StayBindingRequest {
  propertyId: string;
  roomNumber: string;
  reservationId?: string;
  confirmedGuestName?: string;
  unverified?: boolean;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Decide which stay a new order belongs to (INTEGRATION_DESIGN.md §4.3). The
 * server always asks the StayLookup again: it never trusts a folio id or a guest
 * name from the screen.
 *
 * - reservationId + confirmedGuestName: that stay must be in-house in this room now,
 *   with a guest of that name. Stores the stay and folio ids.
 * - unverified: true: only when the lookup is unavailable or not configured.
 *   Stores verification_status = 'unverified' and no ids (the worker re-checks in step 6).
 */
export async function resolveStayBinding(
  lookup: StayLookup,
  req: StayBindingRequest,
  now: Date = new Date(),
): Promise<StayBinding> {
  const room = req.roomNumber.trim();
  const unverified = req.unverified === true;

  if (req.reservationId && unverified) {
    throw new BadRequestException('Send either reservationId (a confirmed guest) or unverified: true, not both.');
  }
  if (!req.reservationId && !unverified) {
    throw new BadRequestException(
      "Confirm the guest's stay (reservationId and confirmedGuestName), or place the order as unverified (unverified: true).",
    );
  }

  if (unverified) {
    const result = await lookup.findInHouseByRoom(req.propertyId, room);
    if (result.kind === 'found') {
      throw new ConflictException(
        `The stay lookup is working: look up room ${room} and confirm the guest instead of placing an unverified order.`,
      );
    }
    if (result.kind === 'none') {
      throw new ConflictException(`HAIP shows no in-house guest in room ${room}. Check the room number.`);
    }
    // unavailable or not_configured: allowed, the screen showed the "Unverified" warning.
    return { haipReservationId: null, haipFolioId: null, verificationStatus: 'unverified', verifiedGuestName: null, verifiedAt: null };
  }

  const name = req.confirmedGuestName?.trim();
  if (!name) throw new BadRequestException('confirmedGuestName is required with reservationId.');

  const result = await lookup.findInHouseByRoom(req.propertyId, room);
  if (result.kind === 'unavailable') {
    throw new ServiceUnavailableException("Can't reach HAIP to check the stay. Try again, or place the order as unverified.");
  }
  if (result.kind === 'not_configured') {
    throw new BadRequestException('No stay lookup is configured. Place the order as unverified.');
  }
  const stay = result.kind === 'found' ? result.stays.find((s) => s.reservationId === req.reservationId) : undefined;
  if (!stay) {
    throw new ConflictException(`That stay is no longer in-house in room ${room}. Look the room up again.`);
  }
  const guest = stay.occupants.map(publicGuest).find((g) => sameName(g.displayName, name) || sameName(g.firstName, name));
  if (!guest) {
    throw new ConflictException(`No guest called "${name}" on that stay. Look the room up again.`);
  }
  return {
    haipReservationId: stay.reservationId,
    haipFolioId: stay.guestFolioId,
    verificationStatus: 'verified',
    verifiedGuestName: guest.displayName,
    verifiedAt: now,
  };
}
