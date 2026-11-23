import { describe, expect, it, vi } from 'vitest';
import { HaipStayLookup, type HaipStayLookupOptions } from './haip-stay-lookup.js';
import { PROPERTY, runStayLookupContract, type ContractStay } from './stay-lookup.contract.js';

const API = 'http://haip.test/api/v1';
const TOKEN_URL = 'http://kc.test/realms/haip/protocol/openid-connect/token';
const SECRET = 'sp-secret-DO-NOT-LEAK';

interface MockOptions {
  stays: Array<ContractStay & { propertyId?: string }>;
  /** Make every HAIP API call (not the token call) fail this way. */
  apiFails?: 'connect' | 503;
  tokenTtlSeconds?: number;
  /** Answer the first API call with 401 (expired token). */
  firstApiCall401?: boolean;
}

/**
 * A fake HAIP + Keycloak built from stays, shaped like the real responses
 * (haip reservation.service list/findById, reservation-party listGuests, folio list).
 * Guest records deliberately include phone and email, which the adapter must drop.
 */
function mockHaip(opts: MockOptions) {
  const calls: string[] = [];
  let tokensIssued = 0;
  let first401 = opts.firstApiCall401 ?? false;
  const stays = opts.stays.map((s) => ({ propertyId: PROPERTY, ...s }));
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    if (url.href === TOKEN_URL) {
      const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
      if (form.get('client_secret') !== SECRET || form.get('grant_type') !== 'client_credentials') return json(401, { error: 'invalid_client' });
      tokensIssued += 1;
      return json(200, { access_token: `token-${tokensIssued}`, expires_in: opts.tokenTtlSeconds ?? 300 });
    }
    if (opts.apiFails === 'connect') throw new TypeError('fetch failed');
    if (opts.apiFails) return json(opts.apiFails, { message: 'down' });
    const auth = (init?.headers as Record<string, string>)?.['Authorization'];
    if (!auth?.startsWith('Bearer token-')) return json(401, {});
    if (first401) {
      first401 = false;
      return json(401, { message: 'jwt expired' });
    }

    const property = url.searchParams.get('propertyId');
    const path = url.pathname.replace('/api/v1', '');
    const guestRow = (s: (typeof stays)[number], i: number) => ({
      id: `rg-${i}`,
      reservationId: s.reservationId,
      role: i === 0 ? 'primary' : 'accompanying',
      firstName: s.occupants[i]!.firstName,
      lastName: `${s.occupants[i]!.lastInitial}ovelace`,
      email: 'guest@example.com',
      phone: '+91 98765 43210',
    });

    if (path === '/reservations') {
      const statuses = (url.searchParams.get('statuses') ?? '').split(',');
      const page = Number(url.searchParams.get('page') ?? '1');
      const limit = Number(url.searchParams.get('limit') ?? '20');
      const all = stays.filter((s) => s.propertyId === property && statuses.includes(s.status));
      const data = all.slice((page - 1) * limit, page * limit).map((s) => ({
        id: s.reservationId,
        propertyId: s.propertyId,
        status: s.status,
        roomNumber: s.roomNumber,
        departureDate: s.departureDate,
        guest: { firstName: s.occupants[0]?.firstName, lastName: 'Lovelace' },
        guestName: `${s.occupants[0]?.firstName} Lovelace`,
      }));
      return json(200, { data, total: all.length, page, limit, hasMore: page * limit < all.length });
    }
    const one = path.match(/^\/reservations\/([^/]+)$/);
    if (one) {
      const s = stays.find((x) => x.reservationId === one[1] && x.propertyId === property);
      if (!s) return json(404, { message: 'Reservation not found' });
      return json(200, {
        reservation: { id: s.reservationId, propertyId: s.propertyId, status: s.status, departureDate: `${s.departureDate}T00:00:00.000Z` },
        guest: { firstName: s.occupants[0]?.firstName, lastName: 'Lovelace', phone: '+91 98765 43210', email: 'guest@example.com' },
        room: s.roomNumber ? { number: s.roomNumber } : null,
      });
    }
    const guests = path.match(/^\/reservations\/([^/]+)\/guests$/);
    if (guests) {
      const s = stays.find((x) => x.reservationId === guests[1] && x.propertyId === property);
      return s ? json(200, s.occupants.map((_, i) => guestRow(s, i))) : json(404, {});
    }
    if (path === '/folios') {
      const s = stays.find((x) => x.reservationId === url.searchParams.get('reservationId') && x.propertyId === property);
      const data = s?.guestFolioId && url.searchParams.get('status') === 'open' ? [{ id: s.guestFolioId, type: 'guest', status: 'open' }] : [];
      return json(200, { data, total: data.length, page: 1, limit: 1 });
    }
    return json(404, {});
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, tokensIssued: () => tokensIssued };
}

function adapter(mock: ReturnType<typeof mockHaip>, extra: Partial<HaipStayLookupOptions> = {}) {
  return new HaipStayLookup({ apiUrl: API, tokenUrl: TOKEN_URL, clientId: 'stayx-pos', clientSecret: SECRET, fetchImpl: mock.fetchImpl, ...extra });
}

runStayLookupContract('HaipStayLookup (mocked HAIP)', {
  arrange: (stays) => adapter(mockHaip({ stays })),
  arrangeUnavailable: () => adapter(mockHaip({ stays: [], apiFails: 503 })),
});

const stay = (n: number, room: string, status = 'checked_in'): ContractStay => ({
  reservationId: `c0000000-0000-4000-a000-00000000000${n}`,
  status,
  roomNumber: room,
  departureDate: '2026-12-01',
  guestFolioId: `c1000000-0000-4000-a000-00000000000${n}`,
  occupants: [{ firstName: 'Ada', lastInitial: 'L' }],
});

describe('HaipStayLookup specifics', () => {
  it('pages through in-house reservations until hasMore is false', async () => {
    const stays = [1, 2, 3, 4, 5].map((n) => stay(n, n === 5 ? '505' : `10${n}`));
    const mock = mockHaip({ stays });
    const result = await adapter(mock, { pageSize: 2 }).findInHouseByRoom(PROPERTY, '505');
    expect(result.kind === 'found' && result.stays[0]!.reservationId).toBe(stays[4]!.reservationId);
    expect(mock.calls.filter((c) => c.startsWith('GET /api/v1/reservations?'))).toHaveLength(3);
  });

  it('asks HAIP only for in-house statuses, scoped to the property', async () => {
    const mock = mockHaip({ stays: [stay(1, '101')] });
    await adapter(mock).findInHouseByRoom(PROPERTY, '101');
    const list = mock.calls.find((c) => c.startsWith('GET /api/v1/reservations?'))!;
    expect(list).toContain(`propertyId=${PROPERTY}`);
    expect(list).toContain('statuses=checked_in,stayover,due_out');
  });

  it('reuses the token until shortly before it expires, then gets a new one', async () => {
    let now = 1_000_000;
    const mock = mockHaip({ stays: [stay(1, '101')], tokenTtlSeconds: 60 });
    const lookup = adapter(mock, { now: () => now });
    await lookup.getStay(PROPERTY, stay(1, '101').reservationId);
    await lookup.getStay(PROPERTY, stay(1, '101').reservationId);
    expect(mock.tokensIssued()).toBe(1);
    now += 31_000; // within 30 s of expiry
    await lookup.getStay(PROPERTY, stay(1, '101').reservationId);
    expect(mock.tokensIssued()).toBe(2);
  });

  it('refreshes the token once when HAIP answers 401', async () => {
    const mock = mockHaip({ stays: [stay(1, '101')], firstApiCall401: true });
    const result = await adapter(mock).getStay(PROPERTY, stay(1, '101').reservationId);
    expect(result.kind).toBe('found');
    expect(mock.tokensIssued()).toBe(2);
  });

  it('a wrong client secret makes the lookup unavailable, and the secret never appears in the reason', async () => {
    const mock = mockHaip({ stays: [stay(1, '101')] });
    const lookup = new HaipStayLookup({ apiUrl: API, tokenUrl: TOKEN_URL, clientId: 'stayx-pos', clientSecret: 'wrong', fetchImpl: mock.fetchImpl });
    const result = await lookup.findInHouseByRoom(PROPERTY, '101');
    expect(result).toEqual({ kind: 'unavailable', reason: 'token endpoint answered HTTP 401' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('connection failures and timeouts are unavailable, never thrown', async () => {
    const down = mockHaip({ stays: [stay(1, '101')], apiFails: 'connect' });
    await expect(adapter(down).findInHouseByRoom(PROPERTY, '101')).resolves.toEqual({ kind: 'unavailable', reason: 'could not connect' });

    const slow = vi.fn(() => Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))) as unknown as typeof fetch;
    const lookup = new HaipStayLookup({ apiUrl: API, tokenUrl: TOKEN_URL, clientId: 'c', clientSecret: SECRET, fetchImpl: slow, timeoutMs: 2000 });
    await expect(lookup.getStay(PROPERTY, 'r')).resolves.toEqual({ kind: 'unavailable', reason: 'no answer within 2s' });
  });

  it('reasons name the endpoint without ids or response bodies', async () => {
    const mock = mockHaip({ stays: [], apiFails: 503 });
    const result = await adapter(mock).getStay(PROPERTY, stay(1, '101').reservationId);
    expect(result).toEqual({ kind: 'unavailable', reason: 'HAIP answered HTTP 503 for /reservations/:id' });
  });

  it('drops the phone and email HAIP returns with guest records', async () => {
    const mock = mockHaip({ stays: [stay(1, '101')] });
    const lookup = adapter(mock);
    const text = JSON.stringify([await lookup.findInHouseByRoom(PROPERTY, '101'), await lookup.getStay(PROPERTY, stay(1, '101').reservationId)]);
    expect(text).not.toMatch(/98765|example\.com|Lovelace|email|phone/);
  });

  it('an in-house stay with no open guest folio has guestFolioId null', async () => {
    const mock = mockHaip({ stays: [{ ...stay(1, '101'), guestFolioId: null }] });
    const result = await adapter(mock).findInHouseByRoom(PROPERTY, '101');
    expect(result.kind === 'found' && result.stays[0]!.guestFolioId).toBeNull();
  });
});
