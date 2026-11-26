import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SESSION_ENDED_MESSAGE, listOrders } from '../api.js';
import { setAuthHooks, socketAuth } from './auth-hooks.js';

const A = 'a0000001-0000-4000-a000-00000000000a';

function respond(status: number, body: unknown = []) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const sentHeaders = (fetchMock: ReturnType<typeof vi.fn>) => (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;

afterEach(() => {
  setAuthHooks(null);
  vi.unstubAllGlobals();
});

describe('API calls with login on', () => {
  it('send the current access token', async () => {
    setAuthHooks({ getToken: () => Promise.resolve('tok-1'), sessionEnded: vi.fn() });
    const fetchMock = respond(200);
    await listOrders(A);
    expect(sentHeaders(fetchMock)['Authorization']).toBe('Bearer tok-1');
  });

  it('on 401, report the session ended (to keep the cart and sign in) and say so', async () => {
    const sessionEnded = vi.fn();
    setAuthHooks({ getToken: () => Promise.resolve('expired'), sessionEnded });
    respond(401, { message: 'Missing or invalid access token' });
    const error = await listOrders(A).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(SESSION_ENDED_MESSAGE);
    expect(sessionEnded).toHaveBeenCalledOnce();
  });

  it('a 403 is shown as the API’s message, without signing out', async () => {
    const sessionEnded = vi.fn();
    setAuthHooks({ getToken: () => Promise.resolve('tok'), sessionEnded });
    respond(403, { message: 'No access to this property' });
    await expect(listOrders(A)).rejects.toThrow('No access to this property');
    expect(sessionEnded).not.toHaveBeenCalled();
  });

  it('a failing token store sends no token rather than breaking the call', async () => {
    setAuthHooks({ getToken: () => Promise.reject(new Error('storage')), sessionEnded: vi.fn() });
    const fetchMock = respond(200);
    await listOrders(A);
    expect(sentHeaders(fetchMock)['Authorization']).toBeUndefined();
  });
});

describe('API calls with login off', () => {
  it('send no token, and a 401 is just an error', async () => {
    const fetchMock = respond(401, { message: 'Missing or invalid access token' });
    await expect(listOrders(A)).rejects.toThrow('Missing or invalid access token');
    expect(sentHeaders(fetchMock)['Authorization']).toBeUndefined();
  });
});

describe('socketAuth', () => {
  it('gives the socket the current token on each (re)connect', async () => {
    let token = 'first';
    setAuthHooks({ getToken: () => Promise.resolve(token), sessionEnded: vi.fn() });
    const first = await new Promise((resolve) => socketAuth(resolve));
    token = 'renewed';
    const second = await new Promise((resolve) => socketAuth(resolve));
    expect([first, second]).toEqual([{ token: 'first' }, { token: 'renewed' }]);
  });

  it('sends no token when login is off or there is none', async () => {
    expect(await new Promise((resolve) => socketAuth(resolve))).toEqual({});
    setAuthHooks({ getToken: () => Promise.resolve(null), sessionEnded: vi.fn() });
    expect(await new Promise((resolve) => socketAuth(resolve))).toEqual({});
  });
});
