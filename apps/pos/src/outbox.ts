import type { BadgeTone } from '@stayx/ui';
import type { OutboxEntry, OutboxStatus, ParkedReason, ResolutionType, ResolveOutboxBody } from './types.js';

/**
 * Rules and wording for the Outbox/Errors screen. Pure, so they can be tested without a
 * browser. The API enforces the same rules; this only decides what the screen offers.
 */

export const STATUS_LABEL: Record<OutboxStatus, string> = {
  needs_attention: 'Needs attention',
  failed: 'Failed',
  pending: 'Waiting to post',
  posted: 'Posted',
  resolved: 'Resolved',
};

export const STATUS_TONE: Record<OutboxStatus, BadgeTone> = {
  needs_attention: 'orange',
  failed: 'purple',
  pending: 'grey',
  posted: 'dark-teal',
  resolved: 'deep-blue',
};

/** Why a charge is parked, in plain words for a manager. */
export const REASON_TEXT: Record<ParkedReason, string> = {
  no_in_house_guest: 'HAIP had no guest checked in to that room.',
  stay_ended: "The guest's stay ended before the charge could be posted.",
  needs_verification: 'Placed as unverified, and no single checked-in guest could be matched to the room.',
  wrong_property: "This hotel isn't set up for HAIP posting (no HAIP key). Post it in HAIP and resolve it, or ask an admin to set the hotel up.",
  haip_rejected: 'HAIP rejected the charge. Fix the cause (see the error), then Retry.',
};

export const REASON_LABEL: Record<ParkedReason, string> = {
  no_in_house_guest: 'No guest in room',
  stay_ended: 'Stay ended',
  needs_verification: 'Needs verification',
  wrong_property: 'Hotel not set up',
  haip_rejected: 'Rejected by HAIP',
};

export const RESOLUTION_LABEL: Record<ResolutionType, string> = {
  posted_manually: 'Posted manually in HAIP',
  collected_otherwise: 'Collected another way (e.g. at the front desk)',
  written_off: 'Written off',
  duplicate_or_error: "Duplicate or error (shouldn't be charged)",
};

export const RESOLUTION_HINT: Record<ResolutionType, string> = {
  posted_manually: 'You added the charge to the guest folio in HAIP yourself. Marked as posted.',
  collected_otherwise: 'The guest paid another way. Closed without a folio charge.',
  written_off: 'Not charged to anyone. Closed without a folio charge.',
  duplicate_or_error: 'This order should never have been charged. Closed without a folio charge.',
};

export const RESOLUTION_TYPES = Object.keys(RESOLUTION_LABEL) as ResolutionType[];

/** These can only be resolved; sending them again could charge the wrong guest (the API answers 409). */
const RESOLVE_ONLY: readonly ParkedReason[] = ['no_in_house_guest', 'stay_ended', 'needs_verification', 'wrong_property'];

const isActionable = (entry: Pick<OutboxEntry, 'status'>) => entry.status === 'needs_attention' || entry.status === 'failed';

export function canResolve(entry: Pick<OutboxEntry, 'status'>): boolean {
  return isActionable(entry);
}

export function canRetry(entry: Pick<OutboxEntry, 'status' | 'parkedReason'>): boolean {
  return isActionable(entry) && !(entry.parkedReason && RESOLVE_ONLY.includes(entry.parkedReason));
}

/** Why Retry is off for this row, or null when it is allowed. */
export function retryBlockedReason(entry: Pick<OutboxEntry, 'status' | 'parkedReason'>): string | null {
  if (!isActionable(entry)) return 'Only charges that need attention or failed can be sent again.';
  if (entry.parkedReason && RESOLVE_ONLY.includes(entry.parkedReason)) {
    return 'Sending it again could charge the wrong guest. Check the folio in HAIP, then Resolve.';
  }
  return null;
}

/** The plain-words explanation for a row. */
export function explain(entry: Pick<OutboxEntry, 'status' | 'parkedReason'>): string {
  if (entry.parkedReason) return REASON_TEXT[entry.parkedReason];
  if (entry.status === 'failed') return 'HAIP could not be reached after several tries. The charge may or may not be on the folio.';
  if (entry.status === 'needs_attention') return 'Needs a person: see the error.';
  if (entry.status === 'pending') return 'Waiting for the next attempt.';
  return '';
}

/**
 * A failed row may already be on the folio (HAIP got the charge but the answer was lost),
 * so whoever retries or resolves it must check the folio in HAIP first.
 */
export const mayAlreadyBePosted = (entry: Pick<OutboxEntry, 'status'>) => entry.status === 'failed';

export const NOTE_MIN = 3;
export const NOTE_MAX = 500;
export const CHARGE_ID_MAX = 64;

export interface ResolveForm {
  resolutionType: ResolutionType | '';
  note: string;
  haipChargeId: string;
}

export const emptyResolveForm: ResolveForm = { resolutionType: '', note: '', haipChargeId: '' };

export type ResolveFormErrors = Partial<Record<keyof ResolveForm, string>>;

export function validateResolveForm(form: ResolveForm): ResolveFormErrors {
  const errors: ResolveFormErrors = {};
  if (!form.resolutionType) errors.resolutionType = 'Choose how it was resolved.';
  const note = form.note.trim();
  if (note.length < NOTE_MIN) errors.note = `Write what was done (at least ${NOTE_MIN} characters).`;
  else if (note.length > NOTE_MAX) errors.note = `Keep the note under ${NOTE_MAX} characters.`;
  if (form.resolutionType === 'posted_manually' && form.haipChargeId.trim().length > CHARGE_ID_MAX) {
    errors.haipChargeId = `At most ${CHARGE_ID_MAX} characters.`;
  }
  return errors;
}

/** The request body. The charge id goes only with posted_manually, and only if filled in. */
export function resolveBody(form: ResolveForm): ResolveOutboxBody {
  if (!form.resolutionType) throw new Error('resolveBody: no resolution type');
  const chargeId = form.haipChargeId.trim();
  return {
    resolutionType: form.resolutionType,
    note: form.note.trim(),
    ...(form.resolutionType === 'posted_manually' && chargeId ? { haipChargeId: chargeId } : {}),
  };
}

/** How often the screen refreshes by itself. */
export const OUTBOX_REFRESH_MS = 30_000;
