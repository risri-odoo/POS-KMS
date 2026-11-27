import { describe, expect, it } from 'vitest';
import {
  REASON_LABEL,
  REASON_TEXT,
  RESOLUTION_HINT,
  RESOLUTION_LABEL,
  RESOLUTION_TYPES,
  STATUS_LABEL,
  STATUS_TONE,
  canResolve,
  canRetry,
  emptyResolveForm,
  explain,
  mayAlreadyBePosted,
  resolveBody,
  retryBlockedReason,
  validateResolveForm,
} from './outbox.js';
import type { OutboxStatus, ParkedReason } from './types.js';

const STATUSES: OutboxStatus[] = ['pending', 'posted', 'failed', 'needs_attention', 'resolved'];
const REASONS: ParkedReason[] = ['no_in_house_guest', 'stay_ended', 'needs_verification', 'wrong_property', 'haip_rejected'];
const row = (status: OutboxStatus, parkedReason: ParkedReason | null = null) => ({ status, parkedReason });

describe('wording', () => {
  it('has a label and tone for every status, and words for every reason and resolution type', () => {
    for (const s of STATUSES) expect(STATUS_LABEL[s] && STATUS_TONE[s]).toBeTruthy();
    for (const r of REASONS) expect(REASON_LABEL[r] && REASON_TEXT[r]).toBeTruthy();
    expect(RESOLUTION_TYPES).toEqual(['posted_manually', 'collected_otherwise', 'written_off', 'duplicate_or_error']);
    for (const t of RESOLUTION_TYPES) expect(RESOLUTION_LABEL[t] && RESOLUTION_HINT[t]).toBeTruthy();
  });

  it('explains a row by its reason, or by its status when there is none', () => {
    expect(explain(row('needs_attention', 'stay_ended'))).toBe(REASON_TEXT.stay_ended);
    expect(explain(row('failed'))).toMatch(/may or may not be on the folio/);
    expect(explain(row('needs_attention'))).toMatch(/see the error/);
  });
});

describe('which actions are offered', () => {
  it('Resolve only for charges that need attention or failed', () => {
    for (const s of ['pending', 'posted', 'resolved'] as const) expect(canResolve(row(s))).toBe(false);
    expect(canResolve(row('needs_attention'))).toBe(true);
    expect(canResolve(row('failed'))).toBe(true);
  });

  it('Retry follows the server’s retryAllowed, and never for closed charges', () => {
    expect(canRetry({ ...row('failed'), retryAllowed: true })).toBe(true);
    expect(canRetry({ ...row('needs_attention', 'haip_rejected'), retryAllowed: false })).toBe(false);
    expect(canRetry({ ...row('posted'), retryAllowed: true })).toBe(false);
  });

  it.each(['no_in_house_guest', 'stay_ended', 'needs_verification'] as const)('a charge parked as %s can only be resolved, with the reason shown', (reason) => {
    const entry = { ...row('needs_attention', reason), retryAllowed: false };
    expect(canRetry(entry)).toBe(false);
    expect(canResolve(entry)).toBe(true);
    expect(retryBlockedReason(entry)).toMatch(/could charge the wrong guest/);
  });

  it('"Hotel not set up": Retry once the hotel’s key is set, otherwise "Add the hotel’s HAIP key first."', () => {
    const without = { ...row('needs_attention', 'wrong_property'), retryAllowed: false };
    expect(canRetry(without)).toBe(false);
    expect(retryBlockedReason(without)).toBe("Add the hotel's HAIP key first.");
    const withKey = { ...row('needs_attention', 'wrong_property'), retryAllowed: true };
    expect(canRetry(withKey)).toBe(true);
    expect(retryBlockedReason(withKey)).toBeNull();
  });

  it('a charge HAIP rejected can be retried once fixed', () => {
    const entry = { ...row('needs_attention', 'haip_rejected'), retryAllowed: true };
    expect(canRetry(entry)).toBe(true);
    expect(retryBlockedReason(entry)).toBeNull();
  });

  it('warns to check the folio first only for failed charges', () => {
    expect(mayAlreadyBePosted(row('failed'))).toBe(true);
    expect(mayAlreadyBePosted(row('needs_attention'))).toBe(false);
  });
});

describe('Resolve form', () => {
  it('the type is a required choice and the note needs real words', () => {
    expect(validateResolveForm(emptyResolveForm)).toEqual({
      resolutionType: 'Choose how it was resolved.',
      note: 'Write what was done (at least 3 characters).',
    });
    expect(validateResolveForm({ resolutionType: 'written_off', note: '   ok  ', haipChargeId: '' })).toHaveProperty('note');
    expect(validateResolveForm({ resolutionType: 'written_off', note: 'x'.repeat(501), haipChargeId: '' })).toHaveProperty('note');
    expect(validateResolveForm({ resolutionType: 'written_off', note: 'Comped by manager', haipChargeId: '' })).toEqual({});
  });

  it('checks the charge id length only when it will be sent', () => {
    const long = 'c'.repeat(65);
    expect(validateResolveForm({ resolutionType: 'posted_manually', note: 'On the folio', haipChargeId: long })).toHaveProperty('haipChargeId');
    expect(validateResolveForm({ resolutionType: 'written_off', note: 'Comped', haipChargeId: long })).toEqual({});
  });

  it('sends the charge id only with posted_manually, trimmed', () => {
    expect(resolveBody({ resolutionType: 'posted_manually', note: '  On the folio ', haipChargeId: ' chg-9 ' })).toEqual({
      resolutionType: 'posted_manually',
      note: 'On the folio',
      haipChargeId: 'chg-9',
    });
    expect(resolveBody({ resolutionType: 'posted_manually', note: 'On the folio', haipChargeId: '  ' })).toEqual({
      resolutionType: 'posted_manually',
      note: 'On the folio',
    });
    // A charge id typed before switching to another type is not sent.
    expect(resolveBody({ resolutionType: 'collected_otherwise', note: 'Paid at desk', haipChargeId: 'chg-9' })).toEqual({
      resolutionType: 'collected_otherwise',
      note: 'Paid at desk',
    });
  });
});
