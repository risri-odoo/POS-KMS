/**
 * What managers see about charges needing attention (AUDIT.md item 15, A2). Pure, so the
 * rules can be tested without a browser. The numbers come from GET /outbox/summary and
 * the outbox.attention_changed socket event.
 */
export const BRIDGE_OFF_MESSAGE = 'HAIP posting is off. Charges are not being sent to guest folios.';

export interface AlertState {
  /** Needs attention + failed + stuck; null until the first answer. */
  count: number | null;
  /** From the summary; null until the first answer. */
  bridgeEnabled: boolean | null;
}

export const initialAlertState: AlertState = { count: null, bridgeEnabled: null };

/** The Outbox/Errors tab: a warning dot when posting is off (and no count), else the count. */
export function navAlert(state: AlertState): { badge?: number; alert?: string } {
  if (state.bridgeEnabled === false) return { alert: BRIDGE_OFF_MESSAGE };
  if (state.count !== null && state.count > 0) return { badge: state.count };
  return {};
}

/** "(3) StayX POS" while charges need attention, so it shows on a background tab. */
export function pageTitle(base: string, state: AlertState): string {
  if (state.bridgeEnabled === false || state.count === null || state.count <= 0) return base;
  return `(${state.count}) ${base}`;
}

/** How many more charges need attention than before; 0 on the first answer or a drop. */
export function addedSince(previous: number | null, next: number): number {
  return previous === null ? 0 : Math.max(0, next - previous);
}

export function attentionNotice(added: number): string {
  return `${added} more charge${added === 1 ? ' needs' : 's need'} attention. See Outbox/Errors.`;
}

/** How often the count is fetched again, besides the live event and each reconnect. */
export const ALERT_REFRESH_MS = 60_000;
