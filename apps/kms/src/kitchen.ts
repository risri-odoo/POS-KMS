import type { ActiveStatus, OrderStatus } from './types.js';

/** The one primary action per column: label and the status it moves the order to. */
export const PRIMARY_ACTION: Record<ActiveStatus, { label: string; to: OrderStatus }> = {
  placed: { label: 'Accept', to: 'accepted' },
  accepted: { label: 'Start preparing', to: 'preparing' },
  preparing: { label: 'Mark ready', to: 'ready' },
  ready: { label: 'Mark delivered', to: 'delivered' },
};

/** Mirrors the API state machine: cancel is allowed up to (not after) ready. */
export function canCancel(status: OrderStatus): boolean {
  return status === 'placed' || status === 'accepted' || status === 'preparing';
}

export const COLUMN_TITLES: Record<ActiveStatus, string> = {
  placed: 'Placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
};

/** Minutes before a ticket warns. Change them here. "amber" shows in HAIP's orange. */
export const AGE_THRESHOLD_MINUTES = { amber: 10, red: 20 } as const;

export type AgeTone = 'normal' | 'amber' | 'red';

/** Whole minutes since `createdAt`, never negative (tablet clocks drift). */
export function minutesSince(createdAt: string, now: number): number {
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 60_000));
}

export function ageTone(minutes: number): AgeTone {
  if (minutes >= AGE_THRESHOLD_MINUTES.red) return 'red';
  if (minutes >= AGE_THRESHOLD_MINUTES.amber) return 'amber';
  return 'normal';
}

/** First 8 characters of a UUID, for the header. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
