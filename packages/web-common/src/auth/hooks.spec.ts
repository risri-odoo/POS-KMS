import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizationHeader, setAuthHooks, socketAuth } from './hooks.js';

afterEach(() => setAuthHooks(null));

describe('authorizationHeader', () => {
  it('is the bearer token when login is on, and nothing when it is off or there is no token', async () => {
    expect(await authorizationHeader()).toEqual({});
    setAuthHooks({ getToken: () => Promise.resolve('tok'), sessionEnded: vi.fn() });
    expect(await authorizationHeader()).toEqual({ Authorization: 'Bearer tok' });
    setAuthHooks({ getToken: () => Promise.resolve(null), sessionEnded: vi.fn() });
    expect(await authorizationHeader()).toEqual({});
  });

  it('sends no token rather than failing when the token store fails', async () => {
    setAuthHooks({ getToken: () => Promise.reject(new Error('storage')), sessionEnded: vi.fn() });
    expect(await authorizationHeader()).toEqual({});
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
