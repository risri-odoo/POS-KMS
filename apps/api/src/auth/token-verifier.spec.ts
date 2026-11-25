import { beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey, type JWTVerifyGetKey } from 'jose';
import { loadAuthConfig } from './auth.config.js';
import { InvalidTokenError, TokenVerifier } from './token-verifier.js';

const ISSUER = 'http://localhost:8080/realms/haip';
const PROPERTY = 'a0000001-0000-4000-a000-000000000001';
const config = loadAuthConfig({ POS_OIDC_ISSUER: ISSUER });

let key: CryptoKey;
let otherKey: CryptoKey;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  key = pair.privateKey;
  otherKey = other.privateKey;
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  jwks = createLocalJWKSet({ keys: [publicJwk] });
});

/** A Keycloak-shaped access token for a POS screen user. */
function token(overrides: Record<string, unknown> = {}, opts: { signWith?: CryptoKey; expiresIn?: string; kid?: string } = {}) {
  const claims: Record<string, unknown> = {
    azp: 'stayx-pos-web',
    preferred_username: 'pos-staff-1',
    resource_access: { 'stayx-pos-api': { roles: ['pos_staff'] }, account: { roles: ['view-profile'] } },
    property_ids: [PROPERTY],
    ...overrides,
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? 'k1' })
    .setIssuer((overrides['iss'] as string) ?? ISSUER)
    .setAudience((overrides['aud'] as string | string[]) ?? ['stayx-pos-api', 'account'])
    .setSubject((overrides['sub'] as string) ?? 'user-1')
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '5m')
    .sign(opts.signWith ?? key);
}

const verifier = () => new TokenVerifier(config, jwks);
const reasonFor = async (t: string) => {
  try {
    await verifier().verify(t);
    return 'accepted';
  } catch (e) {
    return e instanceof InvalidTokenError ? e.message : `other error: ${String(e)}`;
  }
};

describe('TokenVerifier', () => {
  it('accepts a valid token and reads the caller, POS client roles and properties', async () => {
    await expect(verifier().verify(await token())).resolves.toEqual({
      sub: 'user-1',
      username: 'pos-staff-1',
      roles: ['pos_staff'],
      propertyIds: [PROPERTY],
      azp: 'stayx-pos-web',
    });
  });

  it('reads only the POS client’s roles, never another client’s or realm roles', async () => {
    const t = await token({ realm_access: { roles: ['admin'] }, resource_access: { account: { roles: ['manage-account'] } } });
    expect((await verifier().verify(t)).roles).toEqual([]);
  });

  it('accepts the KMS client and falls back to sub when there is no username', async () => {
    const principal = await verifier().verify(await token({ azp: 'stayx-kms-web', preferred_username: undefined, sub: 'kitchen-t1-id' }));
    expect(principal).toMatchObject({ azp: 'stayx-kms-web', username: 'kitchen-t1-id' });
  });

  it('treats a missing or malformed property_ids as no properties', async () => {
    expect((await verifier().verify(await token({ property_ids: undefined }))).propertyIds).toEqual([]);
    expect((await verifier().verify(await token({ property_ids: PROPERTY }))).propertyIds).toEqual([]);
  });

  it('reads roles from a flat claim when configured (generic providers)', async () => {
    const flat = new TokenVerifier({ ...config, rolesClaim: 'roles' }, jwks);
    expect((await flat.verify(await token({ roles: ['pos_manager'] }))).roles).toEqual(['pos_manager']);
  });

  it.each([
    ['an expired token', () => token({}, { expiresIn: '-2m' }), 'token expired'],
    ['a wrong issuer', () => token({ iss: 'http://evil.example/realms/haip' }), 'claim "iss" failed'],
    ['a wrong audience', () => token({ aud: 'haip-api' }), 'claim "aud" failed'],
    ['a client that isn’t a POS screen', () => token({ azp: 'haip-dashboard' }), 'client "haip-dashboard"'],
    ['no azp at all', () => token({ azp: undefined }), 'client "(none)"'],
    ['a signature from another key', () => token({}, { signWith: otherKey }), 'signature does not match'],
    ['an unknown key id', () => token({}, { kid: 'k9' }), 'no matching signing key'],
  ])('refuses %s', async (_label, make, reason) => {
    expect(await reasonFor(await make())).toContain(reason);
  });

  it('refuses a token that is not RS256 (e.g. HS256 or unsigned)', async () => {
    const hs = await new SignJWT({ azp: 'stayx-pos-web' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience('stayx-pos-api')
      .setSubject('u')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-shared-secret-of-enough-length!!'));
    expect(await reasonFor(hs)).not.toBe('accepted');
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ iss: ISSUER, aud: 'stayx-pos-api', sub: 'u', azp: 'stayx-pos-web', exp: 9999999999 })).toString('base64url');
    expect(await reasonFor(`${header}.${body}.`)).not.toBe('accepted');
  });

  it('allows 30 seconds of clock difference (tablets drift), not more', async () => {
    expect(await reasonFor(await token({}, { expiresIn: '-20s' }))).toBe('accepted');
    expect(await reasonFor(await token({}, { expiresIn: '-60s' }))).toBe('token expired');
  });

  it('refuses rubbish', async () => {
    expect(await reasonFor('not-a-jwt')).not.toBe('accepted');
  });
});
