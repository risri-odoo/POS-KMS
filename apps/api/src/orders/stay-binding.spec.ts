import { describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { FakeStayLookup, type FakeStay } from '../haip/fake-stay-lookup.js';
import { NotConfiguredStayLookup } from '../haip/stay-lookup.js';
import { resolveStayBinding } from './stay-binding.js';

const PROPERTY = 'a0000001-0000-4000-a000-000000000001';
const NOW = new Date('2026-11-22T10:00:00Z');

const stay = (n: number, room: string, first: string, initial: string): FakeStay => ({
  propertyId: PROPERTY,
  reservationId: `e0000000-0000-4000-a000-00000000000${n}`,
  status: 'checked_in',
  roomNumber: room,
  departureDate: '2026-12-01',
  guestFolioId: `e1000000-0000-4000-a000-00000000000${n}`,
  occupants: [{ firstName: first, lastInitial: initial }, { firstName: 'Byron', lastInitial: 'K' }],
});
const ADA = stay(1, '101', 'Ada', 'L');

const base = { propertyId: PROPERTY, roomNumber: '101' };

describe('resolveStayBinding: confirmed guest', () => {
  it('binds the stay and its folio, stores the confirmed display name and time', async () => {
    const lookup = new FakeStayLookup([ADA]);
    await expect(
      resolveStayBinding(lookup, { ...base, reservationId: ADA.reservationId, confirmedGuestName: 'Ada L.' }, NOW),
    ).resolves.toEqual({
      haipReservationId: ADA.reservationId,
      haipFolioId: ADA.guestFolioId,
      verificationStatus: 'verified',
      verifiedGuestName: 'Ada L.',
      verifiedAt: NOW,
    });
  });

  it('accepts an accompanying guest, the first name alone, any case, and a padded room number', async () => {
    const lookup = new FakeStayLookup([ADA]);
    const result = await resolveStayBinding(lookup, { ...base, roomNumber: ' 101 ', reservationId: ADA.reservationId, confirmedGuestName: 'byron' }, NOW);
    expect(result.verifiedGuestName).toBe('Byron K.');
  });

  it('binds the chosen stay when the room has two (the worker parks it later if still ambiguous)', async () => {
    const other = stay(2, '101', 'Grace', 'H');
    const lookup = new FakeStayLookup([ADA, other]);
    const result = await resolveStayBinding(lookup, { ...base, reservationId: other.reservationId, confirmedGuestName: 'Grace H.' }, NOW);
    expect(result.haipReservationId).toBe(other.reservationId);
  });

  it('409 when the stay is no longer in-house in that room (checked out, moved, or another room)', async () => {
    const lookup = new FakeStayLookup([ADA]);
    lookup.moveRoom(ADA.reservationId, '305');
    await expect(
      resolveStayBinding(lookup, { ...base, reservationId: ADA.reservationId, confirmedGuestName: 'Ada L.' }),
    ).rejects.toBeInstanceOf(ConflictException);

    lookup.moveRoom(ADA.reservationId, '101');
    lookup.checkOut(ADA.reservationId);
    await expect(
      resolveStayBinding(lookup, { ...base, reservationId: ADA.reservationId, confirmedGuestName: 'Ada L.' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('409 when the name is not a guest on that stay', async () => {
    const lookup = new FakeStayLookup([ADA]);
    await expect(
      resolveStayBinding(lookup, { ...base, reservationId: ADA.reservationId, confirmedGuestName: 'Charles B.' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('400 when the confirmed name is missing', async () => {
    const lookup = new FakeStayLookup([ADA]);
    await expect(resolveStayBinding(lookup, { ...base, reservationId: ADA.reservationId })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('503 when HAIP cannot be reached, 400 when no lookup is configured', async () => {
    const down = new FakeStayLookup([ADA]);
    down.setUnavailable('down');
    const req = { ...base, reservationId: ADA.reservationId, confirmedGuestName: 'Ada L.' };
    await expect(resolveStayBinding(down, req)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(resolveStayBinding(new NotConfiguredStayLookup(), req)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('resolveStayBinding: unverified', () => {
  const unverifiedBinding = {
    haipReservationId: null,
    haipFolioId: null,
    verificationStatus: 'unverified',
    verifiedGuestName: null,
    verifiedAt: null,
  };

  it('is accepted when no stay lookup is configured', async () => {
    await expect(resolveStayBinding(new NotConfiguredStayLookup(), { ...base, unverified: true })).resolves.toEqual(unverifiedBinding);
  });

  it('is accepted when HAIP cannot be reached', async () => {
    const lookup = new FakeStayLookup([ADA]);
    lookup.setUnavailable('down');
    await expect(resolveStayBinding(lookup, { ...base, unverified: true })).resolves.toEqual(unverifiedBinding);
  });

  it('409 while the lookup works and the room has a guest: confirm the guest instead', async () => {
    await expect(resolveStayBinding(new FakeStayLookup([ADA]), { ...base, unverified: true })).rejects.toBeInstanceOf(ConflictException);
  });

  it('409 while the lookup works and the room has no in-house guest', async () => {
    await expect(resolveStayBinding(new FakeStayLookup([ADA]), { ...base, roomNumber: '999', unverified: true })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('resolveStayBinding: request shape', () => {
  it('400 when neither a stay nor unverified is sent (no silent unverified orders)', async () => {
    await expect(resolveStayBinding(new NotConfiguredStayLookup(), base)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 when both are sent', async () => {
    await expect(
      resolveStayBinding(new NotConfiguredStayLookup(), { ...base, reservationId: ADA.reservationId, confirmedGuestName: 'Ada L.', unverified: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
