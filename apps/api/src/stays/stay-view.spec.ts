import { describe, expect, it } from 'vitest';
import type { RoomLookupResult, StayOccupant } from '../haip/stay-lookup.js';
import { publicGuest, toStayLookupResponse } from './stay-view.js';

describe('publicGuest', () => {
  it('returns first name, initial and "First I." display name', () => {
    expect(publicGuest({ firstName: ' Ada ', lastInitial: 'l' })).toEqual({ firstName: 'Ada', lastInitial: 'L', displayName: 'Ada L.' });
  });

  it('keeps only the first letter even if an adapter sends a whole surname', () => {
    expect(publicGuest({ firstName: 'Ada', lastInitial: 'Lovelace' })).toMatchObject({ lastInitial: 'L', displayName: 'Ada L.' });
  });

  it('shows just the first name when there is no surname', () => {
    expect(publicGuest({ firstName: 'Ada', lastInitial: '' })).toMatchObject({ displayName: 'Ada' });
  });
});

describe('toStayLookupResponse', () => {
  it('returns an allow-list of fields: no folio id, contact details or full names, even if the adapter sends them', () => {
    const leaky = {
      firstName: 'Ada',
      lastInitial: 'L',
      lastName: 'Lovelace',
      phone: '+91 98765 43210',
      email: 'ada@example.com',
    } as unknown as StayOccupant;
    const result: RoomLookupResult = {
      kind: 'found',
      stays: [
        {
          reservationId: 'r1',
          roomNumber: '101',
          departureDate: '2026-12-01',
          guestFolioId: 'folio-1',
          occupants: [leaky],
          extra: 'x',
        } as never,
      ],
    };

    const response = toStayLookupResponse(result);

    expect(response).toEqual({
      status: 'found',
      stays: [
        {
          reservationId: 'r1',
          roomNumber: '101',
          departureDate: '2026-12-01',
          guests: [{ firstName: 'Ada', lastInitial: 'L', displayName: 'Ada L.' }],
        },
      ],
    });
    expect(JSON.stringify(response)).not.toMatch(/Lovelace|98765|example\.com|folio-1|guestFolioId/);
  });

  it('drops occupants with no first name', () => {
    const response = toStayLookupResponse({
      kind: 'found',
      stays: [{ reservationId: 'r1', roomNumber: '101', departureDate: '2026-12-01', guestFolioId: null, occupants: [{ firstName: ' ', lastInitial: 'X' }] }],
    });
    expect(response.status === 'found' && response.stays[0]!.guests).toEqual([]);
  });

  it.each([
    [{ kind: 'none' }, { status: 'none' }],
    [{ kind: 'unavailable', reason: 'HTTP 503 from haip.internal' }, { status: 'unavailable' }],
    [{ kind: 'not_configured' }, { status: 'not_configured' }],
  ] as const)('maps %j without the internal reason', (result, expected) => {
    expect(toStayLookupResponse(result)).toEqual(expected);
  });
});
