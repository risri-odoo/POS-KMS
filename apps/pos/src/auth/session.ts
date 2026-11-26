/**
 * Staff login for the POS screen (INTEGRATION_DESIGN.md §8.6). Pure helpers; the
 * sign-in flow itself is in AuthGate.tsx. The API checks every token; what is read
 * here only decides what the screen shows.
 */

/** The POS API client in Keycloak, which holds the POS roles (§8.2). */
export const POS_API_CLIENT = 'stayx-pos-api';
export const DEFAULT_CLIENT_ID = 'stayx-pos-web';

export type AuthSettings = { enabled: false } | { enabled: true; authority: string; clientId: string };

/**
 * Login is on when VITE_OIDC_AUTHORITY is set (e.g. http://localhost:8080/realms/haip).
 * Unset: login off, for local development against an API with POS_AUTH_ENABLED=false.
 */
export function authSettings(env: { VITE_OIDC_AUTHORITY?: string; VITE_OIDC_CLIENT_ID?: string }): AuthSettings {
  const authority = env.VITE_OIDC_AUTHORITY?.trim().replace(/\/+$/, '');
  if (!authority) return { enabled: false };
  return { enabled: true, authority, clientId: env.VITE_OIDC_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID };
}

/** What the screen needs to know about the signed-in user. */
export interface Session {
  username: string;
  roles: string[];
  propertyIds: string[];
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];

/** Reads (does not verify) the access token's claims. Malformed tokens give an empty session. */
export function sessionFromAccessToken(token: string): Session {
  let claims: Record<string, unknown> = {};
  try {
    const part = token.split('.')[1] ?? '';
    const base64 = part.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(base64), (c) => c.codePointAt(0)!);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed && typeof parsed === 'object') claims = parsed as Record<string, unknown>;
  } catch {
    // leave claims empty
  }
  const access = (claims['resource_access'] ?? {}) as Record<string, { roles?: unknown } | undefined>;
  const username = [claims['preferred_username'], claims['sub']].find((v): v is string => typeof v === 'string' && v !== '');
  return {
    username: username ?? 'unknown',
    roles: strings(access[POS_API_CLIENT]?.roles),
    propertyIds: strings(claims['property_ids']),
  };
}

/** Placing orders and looking up stays (§8.4). */
export const canOrder = (roles: string[]) => roles.includes('pos_staff') || roles.includes('pos_manager');
/** Menu editing and the outbox. */
export const canManage = (roles: string[]) => roles.includes('pos_manager');

const ROLE_LABEL: Record<string, string> = { pos_staff: 'Staff', pos_manager: 'Manager', pos_kitchen: 'Kitchen' };

/** e.g. "Manager, Staff". Only POS roles, in a fixed order. */
export function roleLabels(roles: string[]): string {
  return ['pos_manager', 'pos_staff', 'pos_kitchen']
    .filter((r) => roles.includes(r))
    .map((r) => ROLE_LABEL[r])
    .join(', ');
}

export type PropertyChoice =
  | { kind: 'ok'; propertyId: string }
  | { kind: 'choose'; options: string[] }
  | { kind: 'none' };

/**
 * Which hotel to open. The requested one (URL or dev default) if the user may use it;
 * else their only hotel; else let them choose. 'none' when the token lists no hotel.
 */
export function pickProperty(requested: string | null, allowed: string[]): PropertyChoice {
  if (requested && allowed.includes(requested)) return { kind: 'ok', propertyId: requested };
  if (allowed.length === 1) return { kind: 'ok', propertyId: allowed[0]! };
  if (allowed.length > 1) return { kind: 'choose', options: allowed };
  return { kind: 'none' };
}

/** A path on this site to come back to after sign-in; anything else becomes "/". */
export function safeReturnPath(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}
