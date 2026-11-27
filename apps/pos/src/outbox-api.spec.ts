import { afterEach, describe, expect, it, vi } from 'vitest';
import { listOutbox, resolveOutbox, retryOutbox } from './api.js';

const A = 'a0000001-0000-4000-a000-000000000001';
const ROW = '1a000000-0000-4000-8000-00000000000a';

function respond(body: unknown = []) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const call = (fetchMock: ReturnType<typeof vi.fn>) => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url: new URL(url), init, body: init.body ? (JSON.parse(String(init.body)) as unknown) : undefined };
};

afterEach(() => vi.unstubAllGlobals());

describe('outbox API calls', () => {
  it('lists with only the filters that are set', async () => {
    const fetchMock = respond();
    await listOutbox(A, { view: 'all', parkedReason: 'stay_ended', resolutionType: undefined });
    const { url } = call(fetchMock);
    expect(url.pathname).toBe('/api/v1/outbox');
    expect(Object.fromEntries(url.searchParams)).toEqual({ propertyId: A, view: 'all', parkedReason: 'stay_ended' });
  });

  it('Retry sends the trimmed note, or an empty body', async () => {
    let fetchMock = respond({});
    await retryOutbox(A, ROW, '  Room fixed ');
    expect(call(fetchMock)).toMatchObject({ init: { method: 'POST' }, body: { note: 'Room fixed' } });
    expect(call(fetchMock).url.pathname + call(fetchMock).url.search).toBe(`/api/v1/outbox/${ROW}/retry?propertyId=${A}`);

    vi.unstubAllGlobals();
    fetchMock = respond({});
    await retryOutbox(A, ROW, '   ');
    expect(call(fetchMock).body).toEqual({});
  });

  it('Resolve posts the type, note and charge id as given', async () => {
    const fetchMock = respond({});
    await resolveOutbox(A, ROW, { resolutionType: 'posted_manually', note: 'On the folio', haipChargeId: 'chg-1' });
    const { url, init, body } = call(fetchMock);
    expect(url.pathname).toBe(`/api/v1/outbox/${ROW}/resolve`);
    expect(init.method).toBe('POST');
    expect(body).toEqual({ resolutionType: 'posted_manually', note: 'On the folio', haipChargeId: 'chg-1' });
  });
});
