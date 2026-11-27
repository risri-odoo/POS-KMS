import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOutboxSummary } from './api.js';
import { BRIDGE_OFF_MESSAGE, addedSince, attentionNotice, initialAlertState, navAlert, pageTitle } from './outbox-alerts.js';

describe('navAlert (the Outbox/Errors tab)', () => {
  it('shows the count when charges need attention', () => {
    expect(navAlert({ count: 3, bridgeEnabled: true })).toEqual({ badge: 3 });
  });

  it('shows nothing at 0 or before the first answer', () => {
    expect(navAlert({ count: 0, bridgeEnabled: true })).toEqual({});
    expect(navAlert(initialAlertState)).toEqual({});
  });

  it('with HAIP posting off: a warning dot with the message, and no count', () => {
    expect(navAlert({ count: 5, bridgeEnabled: false })).toEqual({ alert: BRIDGE_OFF_MESSAGE });
    expect(BRIDGE_OFF_MESSAGE).toBe('HAIP posting is off. Charges are not being sent to guest folios.');
  });
});

describe('pageTitle (the browser tab)', () => {
  it('"(3) StayX POS" while charges need attention, plain otherwise and when posting is off', () => {
    expect(pageTitle('StayX POS', { count: 3, bridgeEnabled: true })).toBe('(3) StayX POS');
    expect(pageTitle('StayX POS', { count: 0, bridgeEnabled: true })).toBe('StayX POS');
    expect(pageTitle('StayX POS', { count: 3, bridgeEnabled: false })).toBe('StayX POS');
    expect(pageTitle('StayX POS', initialAlertState)).toBe('StayX POS');
  });
});

describe('the notice when more charges need attention', () => {
  it('only for an increase after the first answer', () => {
    expect(addedSince(null, 4)).toBe(0); // first load: the badge is enough
    expect(addedSince(2, 4)).toBe(2);
    expect(addedSince(4, 1)).toBe(0);
    expect(attentionNotice(1)).toBe('1 more charge needs attention. See Outbox/Errors.');
    expect(attentionNotice(2)).toBe('2 more charges need attention. See Outbox/Errors.');
  });
});

describe('getOutboxSummary', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('asks for the hotel’s summary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ total: 2, bridgeEnabled: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await getOutboxSummary('a0000001-0000-4000-a000-000000000001');
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname + url.search).toBe('/api/v1/outbox/summary?propertyId=a0000001-0000-4000-a000-000000000001');
  });
});
