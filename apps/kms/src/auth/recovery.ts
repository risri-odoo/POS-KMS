/**
 * What the kitchen board does when its session ends (§8.6): keep showing the board,
 * show "Sign in again", and quietly try to renew in the background, since a kitchen
 * tablet often loses Wi-Fi for a moment and the refresh token may still be good.
 * Pure state, so it can be tested without a browser or a provider.
 */
export const SILENT_RETRY_MS = 60_000;

export type SessionStatus = 'active' | 'lost';

export type SessionEvent =
  /** A token was loaded: first sign-in or a successful renewal. */
  | { type: 'renewed' }
  /** A 401, a refused socket, or a token that expired without being renewed. */
  | { type: 'ended' };

export function sessionReducer(_status: SessionStatus, event: SessionEvent): SessionStatus {
  return event.type === 'renewed' ? 'active' : 'lost';
}

export const LOST_BANNER = 'Signed out. The board may be out of date and orders cannot be updated.';
