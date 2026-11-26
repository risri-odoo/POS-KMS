import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { AuthConfig } from './auth.config.js';

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

/** Who is calling, taken from a verified token. */
export interface AuthPrincipal {
  sub: string;
  /** preferred_username, else sub. Used as placedBy (§8.1). */
  username: string;
  /** POS client roles, e.g. pos_staff. */
  roles: string[];
  /** Properties this user may act on (the property_ids claim). */
  propertyIds: string[];
  /** The client the token was issued to, e.g. stayx-pos-web. */
  azp: string;
  /** The token's exp (seconds since the epoch). The kitchen socket disconnects then (§8.5). */
  expiresAt: number;
}

/** A token that must be refused. The reason is for the server log, not the caller. */
export class InvalidTokenError extends Error {}

/** Follow a dotted path such as resource_access.stayx-pos-api.roles. */
function claimAt(payload: JWTPayload, path: string): unknown {
  // The client id can contain dots in theory; split on the first two known levels for resource_access.
  const match = path.match(/^resource_access\.(.+)\.roles$/);
  if (match) {
    const access = (payload['resource_access'] ?? {}) as Record<string, { roles?: unknown }>;
    return access[match[1]!]?.roles;
  }
  return path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), payload);
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];

/**
 * Checks a bearer token: RS256 signature from the issuer's key set, iss, aud, exp/nbf
 * (with a small clock allowance for tablets) and azp (§8.3). Roles and property scope are
 * read here but enforced by the route rules (Phase 2 step C).
 */
export class TokenVerifier {
  private readonly getKey: JWTVerifyGetKey;

  constructor(
    private readonly config: AuthConfig,
    /** Tests pass a local key set; production fetches and caches the issuer's JWKS. */
    getKey?: JWTVerifyGetKey,
  ) {
    this.getKey = getKey ?? createRemoteJWKSet(new URL(config.jwksUri));
  }

  async verify(token: string): Promise<AuthPrincipal> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.getKey, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ['RS256'],
        clockTolerance: this.config.clockToleranceSeconds,
        // A token that never expires would keep a socket open forever.
        requiredClaims: ['exp'],
      }));
    } catch (error) {
      throw new InvalidTokenError(reasonOf(error));
    }

    const azp = typeof payload['azp'] === 'string' ? payload['azp'] : '';
    if (!this.config.allowedAzp.includes(azp)) {
      throw new InvalidTokenError(`token issued to client "${azp || '(none)'}", which is not allowed`);
    }
    if (typeof payload.sub !== 'string' || payload.sub === '') throw new InvalidTokenError('token has no subject');

    const username = typeof payload['preferred_username'] === 'string' && payload['preferred_username'] ? payload['preferred_username'] : payload.sub;
    return {
      sub: payload.sub,
      username,
      roles: strings(claimAt(payload, this.config.rolesClaim)),
      propertyIds: strings(payload['property_ids']),
      azp,
      expiresAt: payload.exp!,
    };
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof errors.JWTExpired) return 'token expired';
  if (error instanceof errors.JWTClaimValidationFailed) return `claim "${error.claim}" failed: ${error.reason}`;
  if (error instanceof errors.JWSSignatureVerificationFailed) return 'signature does not match';
  if (error instanceof errors.JOSEAlgNotAllowed) return 'algorithm not allowed';
  if (error instanceof errors.JWKSNoMatchingKey) return 'no matching signing key';
  if (error instanceof errors.JOSEError) return error.code;
  return 'token could not be verified';
}
