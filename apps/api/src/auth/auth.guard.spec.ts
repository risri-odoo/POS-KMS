import { describe, expect, it, vi } from 'vitest';
import { Logger, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { loadAuthConfig } from './auth.config.js';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import { InvalidTokenError, type AuthPrincipal, type TokenVerifier } from './token-verifier.js';
import { Public } from './public.decorator.js';

const PRINCIPAL: AuthPrincipal = { sub: 'u1', username: 'pos-staff-1', roles: ['pos_staff'], propertyIds: ['p1'], azp: 'stayx-pos-web', expiresAt: 0 };
const ON = loadAuthConfig({ POS_OIDC_ISSUER: 'http://localhost:8080/realms/haip' });
const OFF = loadAuthConfig({ POS_AUTH_ENABLED: 'false' });

class Routes {
  open() {}
  closed() {}
}
Public()(Routes.prototype, 'open', Object.getOwnPropertyDescriptor(Routes.prototype, 'open')!);

function context(request: AuthenticatedRequest, handler: 'open' | 'closed' = 'closed', type = 'http') {
  return {
    getType: () => type,
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guard(config = ON, verify: TokenVerifier['verify'] = vi.fn().mockResolvedValue(PRINCIPAL)) {
  return { g: new AuthGuard(new Reflector(), config, { verify } as TokenVerifier), verify };
}

describe('AuthGuard', () => {
  it('lets a valid bearer token through and puts the caller on the request', async () => {
    const request: AuthenticatedRequest = { headers: { authorization: 'Bearer abc.def.ghi' } };
    const { g, verify } = guard();
    await expect(g.canActivate(context(request))).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('abc.def.ghi');
    expect(request.auth).toEqual(PRINCIPAL);
  });

  it.each([
    ['no Authorization header', {}],
    ['a non-bearer scheme', { authorization: 'Basic dXNlcjpwYXNz' }],
    ['an empty bearer', { authorization: 'Bearer ' }],
  ])('401 for %s, without asking the verifier', async (_label, headers) => {
    const { g, verify } = guard();
    await expect(g.canActivate(context({ headers }))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('401 with a generic message for an invalid token; the reason only goes to the log', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { g } = guard(ON, vi.fn().mockRejectedValue(new InvalidTokenError('claim "iss" failed: unexpected "iss" claim value')));
    const error = await g.canActivate(context({ headers: { authorization: 'Bearer x' } })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).message).toBe('Missing or invalid access token');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('claim "iss" failed'));
  });

  it('lets a @Public() route through without a token', async () => {
    const { g, verify } = guard();
    await expect(g.canActivate(context({ headers: {} }, 'open'))).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('lets everything through when auth is off', async () => {
    const { g, verify } = guard(OFF);
    await expect(g.canActivate(context({ headers: {} }))).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('leaves socket messages to the gateway’s own handshake check', async () => {
    const { g } = guard();
    await expect(g.canActivate(context({ headers: {} }, 'closed', 'ws'))).resolves.toBe(true);
  });

  it('passes on unexpected errors instead of turning them into 401', async () => {
    const { g } = guard(ON, vi.fn().mockRejectedValue(new Error('boom')));
    await expect(g.canActivate(context({ headers: { authorization: 'Bearer x' } }))).rejects.toThrow('boom');
  });
});
