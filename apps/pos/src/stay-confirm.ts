import type { PublicStay, StayLookupResponse } from './types.js';

/**
 * Who is ordering: the stay-confirmation state behind the cart (INTEGRATION_DESIGN.md §4.3).
 * Pure, so every rule is unit-tested: a room change clears the guest, the
 * "Unverified" tick never survives an order, and a late reply for an old room is ignored.
 */
export type LookupPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'found'; stays: PublicStay[] }
  /** HAIP shows no in-house guest in the room. */
  | { kind: 'none' }
  /** HAIP couldn't be reached: unverified orders are allowed. */
  | { kind: 'unavailable' }
  /** No stay lookup is set up: unverified orders are allowed. */
  | { kind: 'not_configured' }
  /** The POS API itself couldn't be reached. */
  | { kind: 'error'; message: string };

export interface GuestChoice {
  reservationId: string;
  displayName: string;
}

export interface StayConfirmState {
  /** The trimmed room number this state is about. */
  room: string;
  phase: LookupPhase;
  selected: GuestChoice | null;
  /** Staff ticked "I've confirmed the guest in person" on the Unverified warning. */
  unverifiedConfirmed: boolean;
  /** Why the lookup was reopened (e.g. the server said the stay is no longer in-house). */
  message: string | null;
}

export type StayConfirmAction =
  | { type: 'roomChanged'; room: string }
  | { type: 'lookupStarted'; room: string }
  | { type: 'lookupDone'; room: string; response: StayLookupResponse }
  | { type: 'lookupFailed'; room: string; message: string }
  | { type: 'guestSelected'; reservationId: string; displayName: string }
  | { type: 'unverifiedToggled'; confirmed: boolean }
  | { type: 'orderPlaced' }
  | { type: 'orderRejected'; message: string };

export const initialStayConfirm: StayConfirmState = {
  room: '',
  phase: { kind: 'idle' },
  selected: null,
  unverifiedConfirmed: false,
  message: null,
};

const allowsUnverified = (phase: LookupPhase) => phase.kind === 'unavailable' || phase.kind === 'not_configured';

function phaseFor(response: StayLookupResponse): LookupPhase {
  switch (response.status) {
    case 'found':
      return response.stays.length > 0 ? { kind: 'found', stays: response.stays } : { kind: 'none' };
    case 'none':
      return { kind: 'none' };
    case 'unavailable':
      return { kind: 'unavailable' };
    case 'not_configured':
      return { kind: 'not_configured' };
  }
}

export function stayConfirmReducer(state: StayConfirmState, action: StayConfirmAction): StayConfirmState {
  switch (action.type) {
    case 'roomChanged': {
      const room = action.room.trim();
      // A different room means a different guest: forget everything about the old one.
      return room === state.room ? state : { ...initialStayConfirm, room };
    }
    case 'lookupStarted':
      if (action.room.trim() !== state.room || state.room === '') return state;
      return { ...state, phase: { kind: 'loading' }, selected: null, unverifiedConfirmed: false };
    case 'lookupDone':
      // A reply for a room the staff member has since changed is ignored.
      if (action.room.trim() !== state.room || state.phase.kind !== 'loading') return state;
      return { ...state, phase: phaseFor(action.response) };
    case 'lookupFailed':
      if (action.room.trim() !== state.room || state.phase.kind !== 'loading') return state;
      return { ...state, phase: { kind: 'error', message: action.message } };
    case 'guestSelected': {
      if (state.phase.kind !== 'found') return state;
      const stay = state.phase.stays.find((s) => s.reservationId === action.reservationId);
      if (!stay?.guests.some((g) => g.displayName === action.displayName)) return state;
      return { ...state, selected: { reservationId: action.reservationId, displayName: action.displayName }, message: null };
    }
    case 'unverifiedToggled':
      if (!allowsUnverified(state.phase)) return state;
      return { ...state, unverifiedConfirmed: action.confirmed };
    case 'orderPlaced':
      // The room field is cleared too, so the next order starts from nothing (and the tick is off).
      return initialStayConfirm;
    case 'orderRejected':
      // The server's check failed (stay ended, name not on the stay, lookup now working):
      // drop the choice and the tick, show why, and look the room up again.
      return { ...state, phase: { kind: 'idle' }, selected: null, unverifiedConfirmed: false, message: action.message };
  }
}

export type OrderBinding = { reservationId: string; confirmedGuestName: string } | { unverified: true };

/** What to send with the order, or null when Place order must stay disabled. */
export function orderBinding(state: StayConfirmState): OrderBinding | null {
  if (state.room === '') return null;
  if (state.phase.kind === 'found' && state.selected) {
    return { reservationId: state.selected.reservationId, confirmedGuestName: state.selected.displayName };
  }
  if (allowsUnverified(state.phase) && state.unverifiedConfirmed) return { unverified: true };
  return null;
}

/** The line the cart shows above Place order, so staff can check it before placing. */
export function bindingSummary(state: StayConfirmState): { kind: 'verified' | 'unverified'; text: string } | null {
  const binding = orderBinding(state);
  if (!binding) return null;
  return 'reservationId' in binding
    ? { kind: 'verified', text: `Room ${state.room} · ${binding.confirmedGuestName}` }
    : { kind: 'unverified', text: `Room ${state.room} · Unverified` };
}
