const DEFAULT_API_URL = 'http://localhost:4000/api/v1';

/** REST base, e.g. http://localhost:4000/api/v1 (no trailing slash). */
export const API_URL = (import.meta.env.VITE_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, '');

/** Socket.IO lives on the API's origin (default namespace), not under /api/v1. */
export const SOCKET_URL = new URL(API_URL).origin;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** propertyId from ?propertyId=, or null when missing/invalid. */
export function propertyIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('propertyId')?.trim() ?? null;
  return isUuid(value) ? value : null;
}
