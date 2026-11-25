import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, Logger, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { loadAuthConfig } from './auth.config.js';
import { Public } from './public.decorator.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard, type ScopedRequest } from './roles.guard.js';
import type { AuthPrincipal } from './token-verifier.js';

const P1 = 'a0000001-0000-4000-a000-000000000001';
const P2 = 'a0000002-0000-4000-a000-000000000002';
const ON = loadAuthConfig({ POS_OIDC_ISSUER: 'http://localhost:8080/realms/haip' });
const OFF = loadAuthConfig({ POS_AUTH_ENABLED: 'false' });

const staff: AuthPrincipal = { sub: 's', username: 'pos-staff-1', roles: ['pos_staff'], propertyIds: [P1], azp: 'stayx-pos-web' };
const kitchen: AuthPrincipal = { sub: 'k', username: 'kitchen-t1', roles: ['pos_kitchen'], propertyIds: [P1], azp: 'stayx-kms-web' };
const twoHotels: AuthPrincipal = { ...staff, roles: ['pos_manager'], propertyIds: [P1, P2] };

class Routes {
  managerOnly() {}
  staffAndManager() {}
  open() {}
  noRule() {}
}
const decorate = (decorator: MethodDecorator, name: keyof Routes) =>
  decorator(Routes.prototype, name, Object.getOwnPropertyDescriptor(Routes.prototype, name)!);
decorate(Roles('pos_manager'), 'managerOnly');
decorate(Roles('pos_staff', 'pos_manager'), 'staffAndManager');
decorate(Public(), 'open');

function run(request: Partial<ScopedRequest>, handler: keyof Routes, config = ON, type = 'http') {
  const context = {
    getType: () => type,
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ headers: {}, method: 'GET', url: '/x', ...request }) }),
  } as unknown as ExecutionContext;
  return () => new RolesGuard(new Reflector(), config).canActivate(context);
}

describe('RolesGuard', () => {
  it('allows a caller with one of the route’s roles, for their own property', () => {
    expect(run({ auth: staff, query: { propertyId: P1 } }, 'staffAndManager')()).toBe(true);
    expect(run({ auth: staff, body: { propertyId: P1 } }, 'staffAndManager')()).toBe(true);
    expect(run({ auth: twoHotels, query: { propertyId: P2 } }, 'managerOnly')()).toBe(true);
  });

  it('403 when the caller has no matching role (kitchen on a staff route, staff on a manager route)', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(run({ auth: kitchen, query: { propertyId: P1 } }, 'staffAndManager')).toThrow(ForbiddenException);
    expect(run({ auth: staff, query: { propertyId: P1 } }, 'managerOnly')).toThrow('Your role does not allow this');
    expect(run({ auth: { ...staff, roles: [] }, query: { propertyId: P1 } }, 'staffAndManager')).toThrow(ForbiddenException);
  });

  it('403 for another hotel’s property, in the query or the body', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(run({ auth: staff, query: { propertyId: P2 } }, 'staffAndManager')).toThrow('No access to this property');
    expect(run({ auth: staff, body: { propertyId: P2 } }, 'staffAndManager')).toThrow('No access to this property');
    // Both given: both must be allowed, so a second id can't sneak through.
    expect(run({ auth: staff, query: { propertyId: P1 }, body: { propertyId: P2 } }, 'staffAndManager')).toThrow(ForbiddenException);
  });

  it('403 for a token with no property_ids at all', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(run({ auth: { ...staff, propertyIds: [] }, query: { propertyId: P1 } }, 'staffAndManager')).toThrow(ForbiddenException);
  });

  it('400 when no propertyId is given, or it is repeated', () => {
    expect(run({ auth: staff, query: {} }, 'staffAndManager')).toThrow('propertyId is required');
    expect(run({ auth: staff, query: { propertyId: [P1, P2] } }, 'staffAndManager')).toThrow(BadRequestException);
    expect(run({ auth: staff, body: { propertyId: 7 } }, 'staffAndManager')).toThrow(BadRequestException);
  });

  it('refuses a route that has neither @Roles nor @Public, and logs it as a bug', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(run({ auth: twoHotels, query: { propertyId: P1 } }, 'noRule')).toThrow(ForbiddenException);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('no @Roles or @Public rule'));
  });

  it('401 if no caller is on the request, whatever order the guards ran in', () => {
    expect(run({ query: { propertyId: P1 } }, 'staffAndManager')).toThrow(UnauthorizedException);
  });

  it('lets @Public routes, auth-off and socket messages through', () => {
    expect(run({}, 'open')()).toBe(true);
    expect(run({ query: { propertyId: P2 } }, 'managerOnly', OFF)()).toBe(true);
    expect(run({}, 'managerOnly', ON, 'ws')()).toBe(true);
  });
});
