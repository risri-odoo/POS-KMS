import { describe, expect, it } from 'vitest';
import { demoStays, FakeStayLookup, type FakeStay } from './fake-stay-lookup.js';
import { PROPERTY, runStayLookupContract } from './stay-lookup.contract.js';

runStayLookupContract('FakeStayLookup', {
  arrange: (stays) => new FakeStayLookup(stays.map((s) => ({ ...s, propertyId: PROPERTY }))),
  arrangeUnavailable: () => {
    const fake = new FakeStayLookup();
    fake.setUnavailable('simulated outage');
    return fake;
  },
});

const base: FakeStay = {
  propertyId: PROPERTY,
  reservationId: 'd0000000-0000-4000-a000-000000000001',
  status: 'checked_in',
  roomNumber: '201',
  departureDate: '2026-12-01',
  guestFolioId: 'd1000000-0000-4000-a000-000000000001',
  occupants: [{ firstName: 'Ada', lastInitial: 'L' }],
};

describe('FakeStayLookup controls', () => {
  it('checkOut makes the stay leave the room and stop being in-house', async () => {
    const fake = new FakeStayLookup([base]);
    fake.checkOut(base.reservationId);
    expect(await fake.findInHouseByRoom(PROPERTY, '201')).toEqual({ kind: 'none' });
    const result = await fake.getStay(PROPERTY, base.reservationId);
    expect(result.kind === 'found' && result.stay.inHouse).toBe(false);
  });

  it('moveRoom follows the guest to the new room', async () => {
    const fake = new FakeStayLookup([base]);
    fake.moveRoom(base.reservationId, '305');
    expect(await fake.findInHouseByRoom(PROPERTY, '201')).toEqual({ kind: 'none' });
    expect((await fake.findInHouseByRoom(PROPERTY, '305')).kind).toBe('found');
    const result = await fake.getStay(PROPERTY, base.reservationId);
    expect(result.kind === 'found' && result.stay.roomNumber).toBe('305');
  });

  it('recovers after an outage', async () => {
    const fake = new FakeStayLookup([base]);
    fake.setUnavailable('down');
    expect((await fake.getStay(PROPERTY, base.reservationId)).kind).toBe('unavailable');
    fake.setUnavailable(null);
    expect((await fake.getStay(PROPERTY, base.reservationId)).kind).toBe('found');
  });

  it('trims the room number it is asked for', async () => {
    const fake = new FakeStayLookup([base]);
    expect((await fake.findInHouseByRoom(PROPERTY, ' 201 ')).kind).toBe('found');
  });

  it('returns copies, so callers cannot change its stays', async () => {
    const input = structuredClone(base);
    const fake = new FakeStayLookup([input]);
    input.status = 'checked_out';
    const first = await fake.findInHouseByRoom(PROPERTY, '201');
    if (first.kind === 'found') first.stays[0]!.occupants[0]!.firstName = 'Changed';
    const again = await fake.findInHouseByRoom(PROPERTY, '201');
    expect(again.kind === 'found' && again.stays[0]!.occupants[0]!.firstName).toBe('Ada');
  });

  it('demo stays include one single-stay room and one ambiguous room', async () => {
    const fake = new FakeStayLookup(demoStays());
    const demoProperty = demoStays()[0]!.propertyId;
    const r101 = await fake.findInHouseByRoom(demoProperty, '101');
    const r102 = await fake.findInHouseByRoom(demoProperty, '102');
    expect(r101.kind === 'found' && r101.stays.length).toBe(1);
    expect(r102.kind === 'found' && r102.stays.length).toBe(2);
    expect(await fake.findInHouseByRoom(demoProperty, '103')).toEqual({ kind: 'none' });
  });
});
