import { describe, it, expect, vi } from 'vitest';
import { HaipClient } from './haip-client.js';
import type { InboundCharge } from './charge-mapper.js';

const KEY = 'ck_live_TEST-SECRET-do-not-leak';

const charge: InboundCharge = {
  roomNumber: '1204',
  type: 'food_beverage',
  amount: '34.75',
  currencyCode: 'USD',
  vendorTxnId: 'stayx-rs-1',
  description: 'Room service RS-1 (2 item lines)',
  serviceDate: '2026-10-05',
};

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

function client(fetchImpl: typeof fetch, timeoutMs?: number) {
  return new HaipClient({ apiUrl: 'http://haip.test/api/v1', apiKey: KEY, fetchImpl, ...(timeoutMs ? { timeoutMs } : {}) });
}

describe('HaipClient', () => {
  it('POSTs the charge as JSON with x-api-key to /folio-inbound/charges', async () => {
    const fetchMock = respond(201, { id: 'charge-1', taxCharges: [] });
    await client(fetchMock).postCharge(charge);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://haip.test/api/v1/folio-inbound/charges');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'x-api-key': KEY });
    expect(JSON.parse(init.body)).toEqual(charge);
    expect(JSON.parse(init.body)).not.toHaveProperty('propertyId');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('201 → created with the charge id', async () => {
    expect(await client(respond(201, { id: 'charge-1' })).postCharge(charge)).toEqual({ kind: 'created', chargeId: 'charge-1' });
  });

  it('400 → rejected with the API message', async () => {
    const result = await client(respond(400, { statusCode: 400, message: 'Room 999 is vacant or has no in-house reservation' })).postCharge(charge);
    expect(result).toEqual({ kind: 'rejected', status: 400, message: 'HTTP 400: Room 999 is vacant or has no in-house reservation' });
  });

  it('joins array validation messages', async () => {
    const result = await client(respond(400, { message: ['amount must be positive', 'roomNumber too long'] })).postCharge(charge);
    expect(result).toMatchObject({ kind: 'rejected', message: 'HTTP 400: amount must be positive; roomNumber too long' });
  });

  it.each([500, 429, 503])('%i → unavailable', async (status) => {
    const result = await client(respond(status, { message: 'Internal server error' })).postCharge(charge);
    expect(result).toEqual({ kind: 'unavailable', status, message: `HTTP ${status}: Internal server error` });
  });

  it('timeout → unavailable without throwing', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const result = await client(hang, 50).postCharge(charge);
    expect(result).toEqual({ kind: 'unavailable', message: 'HAIP did not respond within 0.05s' });
  });

  it('network error → unavailable without throwing', async () => {
    const result = await client(vi.fn().mockRejectedValue(new TypeError('fetch failed'))).postCharge(charge);
    expect(result).toEqual({ kind: 'unavailable', message: 'Could not reach HAIP: fetch failed' });
  });

  it('never puts the API key into a message, even if HAIP echoes it', async () => {
    const results = await Promise.all([
      client(respond(401, { message: `Invalid key ${KEY}` })).postCharge(charge),
      client(respond(500, `oops ${KEY}`)).postCharge(charge),
      client(vi.fn().mockRejectedValue(new Error(`connect failed for ${KEY}`))).postCharge(charge),
    ]);
    for (const result of results) {
      expect(JSON.stringify(result)).not.toContain(KEY);
    }
    expect(results[0]).toMatchObject({ kind: 'rejected', message: 'HTTP 401: Invalid key [redacted]' });
  });
});
