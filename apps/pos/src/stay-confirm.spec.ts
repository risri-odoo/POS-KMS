import { describe, expect, it } from 'vitest';
import {
  bindingSummary,
  initialStayConfirm,
  orderBinding,
  stayConfirmReducer,
  type StayConfirmAction,
  type StayConfirmState,
} from './stay-confirm.js';
import type { StayLookupResponse } from './types.js';

const guest = (first: string, initial: string) => ({ firstName: first, lastInitial: initial, displayName: `${first} ${initial}.` });
const ADA_STAY = { reservationId: 'r1', roomNumber: '101', departureDate: '2026-12-01', guests: [guest('Ada', 'L'), guest('Byron', 'K')] };
const GRACE_STAY = { reservationId: 'r2', roomNumber: '102', departureDate: '2026-12-02', guests: [guest('Grace', 'H')] };
const ALAN_STAY = { reservationId: 'r3', roomNumber: '102', departureDate: '2026-12-03', guests: [guest('Alan', 'T')] };

const run = (actions: StayConfirmAction[], from: StayConfirmState = initialStayConfirm) => actions.reduce(stayConfirmReducer, from);
const lookedUp = (room: string, response: StayLookupResponse) =>
  run([
    { type: 'roomChanged', room },
    { type: 'lookupStarted', room },
    { type: 'lookupDone', room, response },
  ]);

describe('stay confirmation: finding and picking a guest', () => {
  it('shows the stays found, with no guest picked and Place order still blocked', () => {
    const state = lookedUp('101', { status: 'found', stays: [ADA_STAY] });
    expect(state.phase).toEqual({ kind: 'found', stays: [ADA_STAY] });
    expect(state.selected).toBeNull();
    expect(orderBinding(state)).toBeNull();
  });

  it('picking a guest gives the binding to send and the cart line', () => {
    const state = run([{ type: 'guestSelected', reservationId: 'r1', displayName: 'Ada L.' }], lookedUp('101', { status: 'found', stays: [ADA_STAY] }));
    expect(orderBinding(state)).toEqual({ reservationId: 'r1', confirmedGuestName: 'Ada L.' });
    expect(bindingSummary(state)).toEqual({ kind: 'verified', text: 'Room 101 · Ada L.' });
  });

  it('room 102 with two stays: the guest picked decides which stay is sent', () => {
    const state = run(
      [{ type: 'guestSelected', reservationId: 'r3', displayName: 'Alan T.' }],
      lookedUp('102', { status: 'found', stays: [GRACE_STAY, ALAN_STAY] }),
    );
    expect(orderBinding(state)).toEqual({ reservationId: 'r3', confirmedGuestName: 'Alan T.' });
  });

  it('ignores a pick that is not one of the guests shown', () => {
    const found = lookedUp('101', { status: 'found', stays: [ADA_STAY] });
    expect(run([{ type: 'guestSelected', reservationId: 'r1', displayName: 'Mallory X.' }], found).selected).toBeNull();
    expect(run([{ type: 'guestSelected', reservationId: 'r2', displayName: 'Ada L.' }], found).selected).toBeNull();
  });

  it('a "found" reply with no stays counts as no guest', () => {
    expect(lookedUp('101', { status: 'found', stays: [] }).phase).toEqual({ kind: 'none' });
  });
});

describe('stay confirmation: changing the room', () => {
  it('clears the picked guest when the room number changes', () => {
    const picked = run([{ type: 'guestSelected', reservationId: 'r1', displayName: 'Ada L.' }], lookedUp('101', { status: 'found', stays: [ADA_STAY] }));
    const changed = run([{ type: 'roomChanged', room: '1015' }], picked);
    expect(changed).toEqual({ ...initialStayConfirm, room: '1015' });
    expect(orderBinding(changed)).toBeNull();
  });

  it('clears the Unverified tick when the room number changes', () => {
    const ticked = run([{ type: 'unverifiedToggled', confirmed: true }], lookedUp('101', { status: 'not_configured' }));
    expect(run([{ type: 'roomChanged', room: '102' }], ticked).unverifiedConfirmed).toBe(false);
  });

  it('keeps the choice when only spaces around the room number change', () => {
    const picked = run([{ type: 'guestSelected', reservationId: 'r1', displayName: 'Ada L.' }], lookedUp('101', { status: 'found', stays: [ADA_STAY] }));
    expect(run([{ type: 'roomChanged', room: ' 101 ' }], picked)).toBe(picked);
  });

  it('ignores a late reply for a room the staff member has since changed', () => {
    const state = run([
      { type: 'roomChanged', room: '101' },
      { type: 'lookupStarted', room: '101' },
      { type: 'roomChanged', room: '102' },
      { type: 'lookupDone', room: '101', response: { status: 'found', stays: [ADA_STAY] } },
    ]);
    expect(state).toEqual({ ...initialStayConfirm, room: '102' });
  });

  it('does not start a lookup for an empty room', () => {
    expect(run([{ type: 'lookupStarted', room: '' }])).toBe(initialStayConfirm);
  });
});

describe('stay confirmation: no guest in the room', () => {
  it('shows none and never allows the order, not even by ticking Unverified', () => {
    const state = run([{ type: 'unverifiedToggled', confirmed: true }], lookedUp('103', { status: 'none' }));
    expect(state.phase).toEqual({ kind: 'none' });
    expect(state.unverifiedConfirmed).toBe(false);
    expect(orderBinding(state)).toBeNull();
  });
});

describe('stay confirmation: unverified orders', () => {
  it.each(['unavailable', 'not_configured'] as const)('%s: allowed only after staff tick the warning', (status) => {
    const shown = lookedUp('101', { status });
    expect(orderBinding(shown)).toBeNull();
    const ticked = run([{ type: 'unverifiedToggled', confirmed: true }], shown);
    expect(orderBinding(ticked)).toEqual({ unverified: true });
    expect(bindingSummary(ticked)).toEqual({ kind: 'unverified', text: 'Room 101 · Unverified' });
    expect(orderBinding(run([{ type: 'unverifiedToggled', confirmed: false }], ticked))).toBeNull();
  });

  it('the tick can’t be set while a guest list is shown', () => {
    const state = run([{ type: 'unverifiedToggled', confirmed: true }], lookedUp('101', { status: 'found', stays: [ADA_STAY] }));
    expect(state.unverifiedConfirmed).toBe(false);
  });

  it('a failure to reach the POS API is not an unverified case', () => {
    const state = run([
      { type: 'roomChanged', room: '101' },
      { type: 'lookupStarted', room: '101' },
      { type: 'lookupFailed', room: '101', message: 'Cannot reach the POS server.' },
      { type: 'unverifiedToggled', confirmed: true },
    ]);
    expect(state.phase).toEqual({ kind: 'error', message: 'Cannot reach the POS server.' });
    expect(orderBinding(state)).toBeNull();
  });

  it('a new lookup clears the tick', () => {
    const ticked = run([{ type: 'unverifiedToggled', confirmed: true }], lookedUp('101', { status: 'unavailable' }));
    expect(run([{ type: 'lookupStarted', room: '101' }], ticked).unverifiedConfirmed).toBe(false);
  });
});

describe('stay confirmation: after placing', () => {
  it('resets everything after an order, so the tick is never left on for the next one', () => {
    const ticked = run([{ type: 'unverifiedToggled', confirmed: true }], lookedUp('101', { status: 'unavailable' }));
    expect(run([{ type: 'orderPlaced' }], ticked)).toBe(initialStayConfirm);
  });

  it('a server rejection drops the choice, keeps the room and shows why', () => {
    const picked = run([{ type: 'guestSelected', reservationId: 'r1', displayName: 'Ada L.' }], lookedUp('101', { status: 'found', stays: [ADA_STAY] }));
    const rejected = run([{ type: 'orderRejected', message: 'That stay is no longer in-house in room 101.' }], picked);
    expect(rejected).toEqual({
      room: '101',
      phase: { kind: 'idle' },
      selected: null,
      unverifiedConfirmed: false,
      message: 'That stay is no longer in-house in room 101.',
    });
    expect(orderBinding(rejected)).toBeNull();
  });

  it('the reason stays visible while the room is looked up again, and clears once a guest is picked', () => {
    const rejected = run([{ type: 'orderRejected', message: 'Stay ended.' }], lookedUp('101', { status: 'found', stays: [ADA_STAY] }));
    const relooked = run([
      { type: 'lookupStarted', room: '101' },
      { type: 'lookupDone', room: '101', response: { status: 'found', stays: [ADA_STAY] } },
    ], rejected);
    expect(relooked.message).toBe('Stay ended.');
    expect(run([{ type: 'guestSelected', reservationId: 'r1', displayName: 'Byron K.' }], relooked).message).toBeNull();
  });
});
