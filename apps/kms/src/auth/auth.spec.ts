import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SIGNED_OUT_MESSAGE, updateOrderStatus } from '../api.js';
import { setAuthHooks, socketAuth } from './auth-hooks.js';
import { sessionReducer } from './recovery.js';
import { authSettings, canUseBoard, pickProperty, sessionFromAccessToken } from './session.js';

const A = 'a0000001-0000-4000-a000-00000000000a';
const B = 'b0000002-0000-4000-a000-00000000000b';
const ORDER = '0a000000-0000-4000-8000-00000000000a';

function tokenWith(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.sig`;
}

function respond(status: number, body: unknown = {}) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const sentHeaders = (fetchMock: ReturnType<typeof vi.fn>) => (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;

afterEach(() => {
  setAuthHooks(null);
  vi.unstubAllGlobals();
});

describe('kitchen board login settings', () => {
  it('defaults to the kitchen client, and is off without an authority', () => {
    expect(authSettings({ VITE_OIDC_AUTHORITY: 'http://localhost:8080/realms/haip' })).toEqual({
      enabled: true,
      authority: 'http://localhost:8080/realms/haip',
      clientId: 'stayx-kms-web',
    });
    expect(authSettings({})).toEqual({ enabled: false });
  });
});

describe('who may run the board', () => {
  it('kitchen and managers; not staff-only accounts', () => {
    expect(canUseBoard(['pos_kitchen'])).toBe(true);
    expect(canUseBoard(['pos_manager'])).toBe(true);
    expect(canUseBoard(['pos_staff'])).toBe(false);
    expect(canUseBoard([])).toBe(false);
  });

  it('a tablet account opens its one hotel, whatever the URL says', () => {
    const session = sessionFromAccessToken(tokenWith({ sub: 't1', preferred_username: 'kitchen-t1', resource_access: { 'stayx-pos-api': { roles: ['pos_kitchen'] } }, property_ids: [A] }));
    expect(session).toEqual({ sub: 't1', username: 'kitchen-t1', roles: ['pos_kitchen'], propertyIds: [A] });
    expect(pickProperty(B, session.propertyIds)).toEqual({ kind: 'ok', propertyId: A });
    expect(pickProperty(null, session.propertyIds)).toEqual({ kind: 'ok', propertyId: A });
  });
});

describe('session lost and recovered', () => {
  it('ends on a refusal and comes back on the next token', () => {
    expect(sessionReducer('active', { type: 'ended' })).toBe('lost');
    expect(sessionReducer('lost', { type: 'ended' })).toBe('lost');
    expect(sessionReducer('lost', { type: 'renewed' })).toBe('active');
  });
});

describe('API calls with login on', () => {
  it('send the access token', async () => {
    setAuthHooks({ getToken: () => Promise.resolve('tok-1'), sessionEnded: vi.fn() });
    const fetchMock = respond(200, { id: ORDER });
    await updateOrderStatus(A, ORDER, 'accepted');
    expect(sentHeaders(fetchMock)['Authorization']).toBe('Bearer tok-1');
  });

  it('on 401, report the session lost (banner, board stays) and say why the change failed', async () => {
    const sessionEnded = vi.fn();
    setAuthHooks({ getToken: () => Promise.resolve(null), sessionEnded });
    const fetchMock = respond(401, { message: 'Missing or invalid access token' });
    const error = await updateOrderStatus(A, ORDER, 'accepted').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(SIGNED_OUT_MESSAGE);
    expect(sessionEnded).toHaveBeenCalledOnce();
    expect(sentHeaders(fetchMock)['Authorization']).toBeUndefined();
  });

  it('a 403 (e.g. another hotel) is an error message, not a sign-out', async () => {
    const sessionEnded = vi.fn();
    setAuthHooks({ getToken: () => Promise.resolve('tok'), sessionEnded });
    respond(403, { message: 'No access to this property' });
    await expect(updateOrderStatus(A, ORDER, 'accepted')).rejects.toThrow('No access to this property');
    expect(sessionEnded).not.toHaveBeenCalled();
  });
});

describe('API calls with login off', () => {
  it('send no token', async () => {
    const fetchMock = respond(200, { id: ORDER });
    await updateOrderStatus(A, ORDER, 'accepted');
    expect(sentHeaders(fetchMock)['Authorization']).toBeUndefined();
  });
});

describe('socketAuth', () => {
  it('gives each (re)connect the latest token, and none when login is off', async () => {
    expect(await new Promise((resolve) => socketAuth(resolve))).toEqual({});
    let token = 'first';
    setAuthHooks({ getToken: () => Promise.resolve(token), sessionEnded: vi.fn() });
    const first = await new Promise((resolve) => socketAuth(resolve));
    token = 'renewed';
    expect([first, await new Promise((resolve) => socketAuth(resolve))]).toEqual([{ token: 'first' }, { token: 'renewed' }]);
  });
});
