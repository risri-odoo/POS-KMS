import { describe, expect, it } from 'vitest';
import type { StayLookup, StayOccupant } from './stay-lookup.js';

/**
 * Shared behaviour every StayLookup adapter must have. Run from each adapter's
 * spec with a harness that can set up the scenario (the fake directly; the real
 * HAIP adapter, in Phase 1 step 7, through mocked HTTP responses).
 */
export interface ContractStay {
  reservationId: string;
  status: string;
  roomNumber: string | null;
  departureDate: string;
  guestFolioId: string | null;
  occupants: StayOccupant[];
}

export interface ContractHarness {
  /** A lookup for PROPERTY that holds exactly these stays. */
  arrange(stays: ContractStay[]): StayLookup | Promise<StayLookup>;
  /** A lookup that can't reach HAIP. */
  arrangeUnavailable(): StayLookup | Promise<StayLookup>;
}

export const PROPERTY = 'a0000001-0000-4000-a000-000000000001';
export const OTHER_PROPERTY = 'b0000002-0000-4000-b000-000000000002';

const stay = (n: number, room: string | null, status = 'checked_in'): ContractStay => ({
  reservationId: `c0000000-0000-4000-a000-00000000000${n}`,
  status,
  roomNumber: room,
  departureDate: '2026-12-01',
  guestFolioId: `c1000000-0000-4000-a000-00000000000${n}`,
  occupants: [
    { firstName: 'Ada', lastInitial: 'L' },
    { firstName: 'Byron', lastInitial: 'K' },
  ],
});

export function runStayLookupContract(name: string, harness: ContractHarness): void {
  describe(`StayLookup contract: ${name}`, () => {
    describe('findInHouseByRoom', () => {
      it('returns the in-house stay with its folio and occupants (first name + initial only)', async () => {
        const lookup = await harness.arrange([stay(1, '101')]);
        const result = await lookup.findInHouseByRoom(PROPERTY, '101');
        expect(result).toEqual({
          kind: 'found',
          stays: [
            {
              reservationId: stay(1, '101').reservationId,
              roomNumber: '101',
              departureDate: '2026-12-01',
              guestFolioId: stay(1, '101').guestFolioId,
              occupants: [
                { firstName: 'Ada', lastInitial: 'L' },
                { firstName: 'Byron', lastInitial: 'K' },
              ],
            },
          ],
        });
      });

      it('never exposes contact details or full surnames', async () => {
        const lookup = await harness.arrange([stay(1, '101')]);
        const text = JSON.stringify(await lookup.findInHouseByRoom(PROPERTY, '101'));
        expect(text).not.toMatch(/phone|email|lastName/i);
      });

      it('returns every in-house stay when a room has more than one', async () => {
        const lookup = await harness.arrange([stay(1, '102'), stay(2, '102')]);
        const result = await lookup.findInHouseByRoom(PROPERTY, '102');
        expect(result.kind).toBe('found');
        if (result.kind === 'found') expect(result.stays.map((s) => s.reservationId).sort()).toEqual([stay(1, '102').reservationId, stay(2, '102').reservationId].sort());
      });

      it('ignores stays that are not in-house', async () => {
        const lookup = await harness.arrange([stay(1, '103', 'checked_out'), stay(2, '103', 'confirmed'), stay(3, '103', 'cancelled')]);
        expect(await lookup.findInHouseByRoom(PROPERTY, '103')).toEqual({ kind: 'none' });
      });

      it('counts stayover and due_out as in-house', async () => {
        const lookup = await harness.arrange([stay(1, '104', 'stayover'), stay(2, '105', 'due_out')]);
        expect((await lookup.findInHouseByRoom(PROPERTY, '104')).kind).toBe('found');
        expect((await lookup.findInHouseByRoom(PROPERTY, '105')).kind).toBe('found');
      });

      it('returns none for an empty room', async () => {
        const lookup = await harness.arrange([stay(1, '101')]);
        expect(await lookup.findInHouseByRoom(PROPERTY, '999')).toEqual({ kind: 'none' });
      });

      it('never returns another property’s stays', async () => {
        const lookup = await harness.arrange([stay(1, '101')]);
        expect(await lookup.findInHouseByRoom(OTHER_PROPERTY, '101')).toEqual({ kind: 'none' });
      });

      it('returns unavailable, without throwing, when HAIP cannot be reached', async () => {
        const lookup = await harness.arrangeUnavailable();
        expect((await lookup.findInHouseByRoom(PROPERTY, '101')).kind).toBe('unavailable');
      });
    });

    describe('getStay', () => {
      it('returns status, current room and folio for an in-house stay', async () => {
        const lookup = await harness.arrange([stay(1, '101')]);
        expect(await lookup.getStay(PROPERTY, stay(1, '101').reservationId)).toEqual({
          kind: 'found',
          stay: {
            reservationId: stay(1, '101').reservationId,
            status: 'checked_in',
            inHouse: true,
            roomNumber: '101',
            departureDate: '2026-12-01',
            guestFolioId: stay(1, '101').guestFolioId,
          },
        });
      });

      it('reports a checked-out stay as not in-house', async () => {
        const lookup = await harness.arrange([stay(1, '101', 'checked_out')]);
        const result = await lookup.getStay(PROPERTY, stay(1, '101').reservationId);
        expect(result.kind).toBe('found');
        if (result.kind === 'found') expect(result.stay.inHouse).toBe(false);
      });

      it('returns not_found for an unknown id or another property', async () => {
        const lookup = await harness.arrange([stay(1, '101')]);
        expect(await lookup.getStay(PROPERTY, 'c0000000-0000-4000-a000-000000000999')).toEqual({ kind: 'not_found' });
        expect(await lookup.getStay(OTHER_PROPERTY, stay(1, '101').reservationId)).toEqual({ kind: 'not_found' });
      });

      it('returns unavailable, without throwing, when HAIP cannot be reached', async () => {
        const lookup = await harness.arrangeUnavailable();
        expect((await lookup.getStay(PROPERTY, stay(1, '101').reservationId)).kind).toBe('unavailable');
      });
    });
  });
}
