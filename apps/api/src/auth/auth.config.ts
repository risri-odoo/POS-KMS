export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

/** Staff login settings (INTEGRATION_DESIGN.md §8.3). */
export interface AuthConfig {
  enabled: boolean;
  issuer: string;
  jwksUri: string;
  audience: string;
  allowedAzp: string[];
  /** Dotted path to the roles array, e.g. resource_access.stayx-pos-api.roles */
  rolesClaim: string;
  clockToleranceSeconds: number;
}

const DEFAULT_AUDIENCE = 'stayx-pos-api';
const DEFAULT_AZP = 'stayx-pos-web,stayx-kms-web';

const read = (env: NodeJS.ProcessEnv, name: string) => env[name]?.trim() || undefined;

/**
 * Reads the POS_* login settings. Throws (so the API refuses to start) when auth is
 * off in production, or on with no issuer.
 * - POS_AUTH_ENABLED: on unless set to "false". Local development may turn it off.
 * - POS_OIDC_ISSUER: required when on, e.g. http://localhost:8080/realms/haip
 * - POS_OIDC_JWKS_URI: defaults to Keycloak's <issuer>/protocol/openid-connect/certs
 * - POS_OIDC_AUDIENCE (default stayx-pos-api), POS_OIDC_ALLOWED_AZP (comma list),
 *   POS_OIDC_ROLES_CLAIM (default resource_access.<audience>.roles)
 */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const flag = read(env, 'POS_AUTH_ENABLED')?.toLowerCase();
  if (flag !== undefined && flag !== 'true' && flag !== 'false') {
    throw new Error(`POS_AUTH_ENABLED="${flag}" must be true or false`);
  }
  const enabled = flag !== 'false';
  const production = read(env, 'NODE_ENV')?.toLowerCase() === 'production';
  if (!enabled && production) {
    throw new Error('POS_AUTH_ENABLED=false is not allowed when NODE_ENV=production');
  }

  const audience = read(env, 'POS_OIDC_AUDIENCE') ?? DEFAULT_AUDIENCE;
  const issuer = (read(env, 'POS_OIDC_ISSUER') ?? '').replace(/\/+$/, '');
  if (enabled && !issuer) {
    throw new Error('POS_OIDC_ISSUER is required while POS_AUTH_ENABLED is on (set POS_AUTH_ENABLED=false for local development)');
  }
  return {
    enabled,
    issuer,
    jwksUri: read(env, 'POS_OIDC_JWKS_URI') ?? (issuer ? `${issuer}/protocol/openid-connect/certs` : ''),
    audience,
    allowedAzp: (read(env, 'POS_OIDC_ALLOWED_AZP') ?? DEFAULT_AZP)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    rolesClaim: read(env, 'POS_OIDC_ROLES_CLAIM') ?? `resource_access.${audience}.roles`,
    clockToleranceSeconds: 30,
  };
}
