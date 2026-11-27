import { describe, expect, it } from 'vitest';
import { authSettings, canManage, canOrder, canUseBoard, pickProperty, roleLabels, safeReturnPath, sessionFromAccessToken } from './session.js';

const A = 'a0000001-0000-4000-a000-00000000000a';
const B = 'b0000002-0000-4000-a000-00000000000b';

/** An unsigned token-shaped string; the screen only reads claims, the API verifies. */
function tokenWith(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.sig`;
}

describe('authSettings', () => {
  it('is off without an authority (local development)', () => {
    expect(authSettings({}, 'stayx-pos-web')).toEqual({ enabled: false });
    expect(authSettings({ VITE_OIDC_AUTHORITY: '  ' }, 'stayx-pos-web')).toEqual({ enabled: false });
  });

  it('is on with an authority, defaulting the client to stayx-pos-web', () => {
    expect(authSettings({ VITE_OIDC_AUTHORITY: 'http://localhost:8080/realms/haip/' }, 'stayx-pos-web')).toEqual({
      enabled: true,
      authority: 'http://localhost:8080/realms/haip',
      clientId: 'stayx-pos-web',
    });
    expect(authSettings({ VITE_OIDC_AUTHORITY: 'https://id.example', VITE_OIDC_CLIENT_ID: 'pos-x' }, 'stayx-pos-web')).toMatchObject({ clientId: 'pos-x' });
  });
});

describe('sessionFromAccessToken', () => {
  it('reads the username, POS client roles and hotels', () => {
    const token = tokenWith({
      sub: 'id-1',
      preferred_username: 'pos-staff-1',
      realm_access: { roles: ['admin'] },
      resource_access: { 'stayx-pos-api': { roles: ['pos_staff'] }, account: { roles: ['manage-account'] } },
      property_ids: [A],
    });
    expect(sessionFromAccessToken(token)).toEqual({ sub: 'id-1', username: 'pos-staff-1', roles: ['pos_staff'], propertyIds: [A] });
  });

  it('handles non-ASCII names and falls back to sub', () => {
    expect(sessionFromAccessToken(tokenWith({ preferred_username: 'zoë' })).username).toBe('zoë');
    expect(sessionFromAccessToken(tokenWith({ sub: 'id-9' })).username).toBe('id-9');
  });

  it('gives an empty session for a malformed token, never throws', () => {
    expect(sessionFromAccessToken('garbage')).toEqual({ sub: '', username: 'unknown', roles: [], propertyIds: [] });
    expect(sessionFromAccessToken(tokenWith({ property_ids: A, resource_access: { 'stayx-pos-api': { roles: 'pos_manager' } } }))).toMatchObject({
      roles: [],
      propertyIds: [],
    });
  });
});

describe('roles', () => {
  it('staff and managers take orders; the kitchen does not', () => {
    expect(canOrder(['pos_staff'])).toBe(true);
    expect(canOrder(['pos_manager'])).toBe(true);
    expect(canOrder(['pos_kitchen'])).toBe(false);
    expect(canOrder([])).toBe(false);
  });

  it('only managers manage', () => {
    expect(canManage(['pos_manager'])).toBe(true);
    expect(canManage(['pos_staff', 'pos_kitchen'])).toBe(false);
  });

  it('labels POS roles only, in a fixed order', () => {
    expect(roleLabels(['pos_staff', 'offline_access', 'pos_manager'])).toBe('Manager, Staff');
  });
});

describe('pickProperty', () => {
  it('opens the requested hotel when the user may use it', () => {
    expect(pickProperty(B, [A, B])).toEqual({ kind: 'ok', propertyId: B });
  });

  it('opens the user’s only hotel instead of one they may not use', () => {
    expect(pickProperty(B, [A])).toEqual({ kind: 'ok', propertyId: A });
    expect(pickProperty(null, [A])).toEqual({ kind: 'ok', propertyId: A });
  });

  it('asks when there are several and none (or a foreign one) was requested', () => {
    expect(pickProperty(null, [A, B])).toEqual({ kind: 'choose', options: [A, B] });
    expect(pickProperty('c0000003-0000-4000-a000-00000000000c', [A, B])).toEqual({ kind: 'choose', options: [A, B] });
  });

  it('none when the token lists no hotel', () => {
    expect(pickProperty(A, [])).toEqual({ kind: 'none' });
  });
});

describe('safeReturnPath', () => {
  it('keeps paths on this site and rejects everything else', () => {
    expect(safeReturnPath('/?propertyId=x#menu')).toBe('/?propertyId=x#menu');
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', '', undefined, 42]) expect(safeReturnPath(bad)).toBe('/');
  });
});

describe('canUseBoard', () => {
  it('kitchen and managers run the board; staff-only accounts do not', () => {
    expect(canUseBoard(['pos_kitchen'])).toBe(true);
    expect(canUseBoard(['pos_manager'])).toBe(true);
    expect(canUseBoard(['pos_staff'])).toBe(false);
  });

  it('the kitchen client is just a different default', () => {
    expect(authSettings({ VITE_OIDC_AUTHORITY: 'http://localhost:8080/realms/haip' }, 'stayx-kms-web')).toMatchObject({ clientId: 'stayx-kms-web' });
  });
});
