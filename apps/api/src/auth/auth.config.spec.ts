import { describe, expect, it } from 'vitest';
import { loadAuthConfig } from './auth.config.js';

const ISSUER = 'http://localhost:8080/realms/haip';

describe('loadAuthConfig', () => {
  it('is ON by default, and then needs an issuer', () => {
    expect(() => loadAuthConfig({})).toThrow('POS_OIDC_ISSUER is required while POS_AUTH_ENABLED is on');
    expect(loadAuthConfig({ POS_OIDC_ISSUER: ISSUER }).enabled).toBe(true);
  });

  it('uses the agreed defaults for Keycloak', () => {
    expect(loadAuthConfig({ POS_OIDC_ISSUER: `${ISSUER}/` })).toEqual({
      enabled: true,
      issuer: ISSUER,
      jwksUri: `${ISSUER}/protocol/openid-connect/certs`,
      audience: 'stayx-pos-api',
      allowedAzp: ['stayx-pos-web', 'stayx-kms-web'],
      rolesClaim: 'resource_access.stayx-pos-api.roles',
      clockToleranceSeconds: 30,
    });
  });

  it('takes every setting from the environment', () => {
    const config = loadAuthConfig({
      POS_OIDC_ISSUER: 'https://auth.example.com',
      POS_OIDC_JWKS_URI: 'https://auth.example.com/oauth/v2/keys',
      POS_OIDC_AUDIENCE: 'pos-project',
      POS_OIDC_ALLOWED_AZP: ' a , b ',
      POS_OIDC_ROLES_CLAIM: 'roles',
    });
    expect(config).toMatchObject({ jwksUri: 'https://auth.example.com/oauth/v2/keys', audience: 'pos-project', allowedAzp: ['a', 'b'], rolesClaim: 'roles' });
  });

  it('can be turned off for local development, with no issuer needed', () => {
    expect(loadAuthConfig({ POS_AUTH_ENABLED: 'false' }).enabled).toBe(false);
    expect(loadAuthConfig({ POS_AUTH_ENABLED: ' FALSE ', NODE_ENV: 'development' }).enabled).toBe(false);
  });

  it('refuses auth off in production, so the API won’t start', () => {
    expect(() => loadAuthConfig({ POS_AUTH_ENABLED: 'false', NODE_ENV: 'production' })).toThrow(
      'POS_AUTH_ENABLED=false is not allowed when NODE_ENV=production',
    );
  });

  it('refuses a value that is neither true nor false, instead of guessing', () => {
    expect(() => loadAuthConfig({ POS_AUTH_ENABLED: 'off', POS_OIDC_ISSUER: ISSUER })).toThrow('must be true or false');
  });
});
