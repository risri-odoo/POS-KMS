import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { FakeStayLookup } from '../haip/fake-stay-lookup.js';
import { StaysController } from './stays.controller.js';

const PROPERTY = 'a0000001-0000-4000-a000-000000000001';

describe('StaysController.lookup', () => {
  it('returns the room’s in-house stays with first names and initials', async () => {
    const lookup = new FakeStayLookup([
      {
        propertyId: PROPERTY,
        reservationId: 'r1',
        status: 'checked_in',
        roomNumber: '101',
        departureDate: '2026-12-01',
        guestFolioId: 'folio-1',
        occupants: [{ firstName: 'Ada', lastInitial: 'L' }],
      },
    ]);
    const controller = new StaysController(lookup);

    await expect(controller.lookup({ propertyId: PROPERTY, roomNumber: '101' })).resolves.toEqual({
      status: 'found',
      stays: [{ reservationId: 'r1', roomNumber: '101', departureDate: '2026-12-01', guests: [{ firstName: 'Ada', lastInitial: 'L', displayName: 'Ada L.' }] }],
    });
  });

  it('logs why HAIP was unavailable but does not send the reason to the screen', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const lookup = new FakeStayLookup();
    lookup.setUnavailable('connect ECONNREFUSED 10.1.2.3:3000');

    await expect(new StaysController(lookup).lookup({ propertyId: PROPERTY, roomNumber: '101' })).resolves.toEqual({ status: 'unavailable' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });
});
