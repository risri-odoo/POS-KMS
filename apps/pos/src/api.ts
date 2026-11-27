import { API_URL } from './config.js';
import { authHooks } from '@stayx/web-common/auth';
import type {
  CreateMenuItemBody,
  MenuItem,
  Order,
  OrderWithItems,
  OutboxEntry,
  OutboxQuery,
  PlaceOrderBody,
  ResolveOutboxBody,
  StayLookupResponse,
  UpdateMenuItemBody,
} from './types.js';

/** An HTTP or network failure with a message that is always safe to show staff. */
export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 when the request never reached the API. */
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const SESSION_ENDED_MESSAGE = 'Your session has ended. Signing you in again…';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hooks = authHooks();
  const token = hooks ? await hooks.getToken().catch(() => null) : null;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the POS server. Check the connection and try again.');
  }
  if (res.status === 401 && hooks) {
    hooks.sessionEnded();
    throw new ApiError(401, SESSION_ENDED_MESSAGE);
  }
  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: unknown };
      if (Array.isArray(body.message)) message = body.message.filter((m) => typeof m === 'string').join('; ') || message;
      else if (typeof body.message === 'string' && body.message) message = body.message;
    } catch {
      // Non-JSON body: keep the status text.
    }
    // The API hides internal errors behind a generic 500; say so plainly.
    if (res.status >= 500) message = 'The server had a problem. Please try again.';
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const q = encodeURIComponent;

export function listMenu(propertyId: string): Promise<MenuItem[]> {
  return request(`/menu-items?propertyId=${q(propertyId)}`);
}

export function createMenuItem(body: CreateMenuItemBody): Promise<MenuItem> {
  return request('/menu-items', { method: 'POST', body: JSON.stringify(body) });
}

export function updateMenuItem(propertyId: string, id: string, body: UpdateMenuItemBody): Promise<MenuItem> {
  return request(`/menu-items/${q(id)}?propertyId=${q(propertyId)}`, { method: 'PATCH', body: JSON.stringify(body) });
}

/** Newest first; the API returns the whole history, the feed keeps the latest 20. */
export function listOrders(propertyId: string): Promise<Order[]> {
  return request(`/orders?propertyId=${q(propertyId)}`);
}

export function placeOrder(body: PlaceOrderBody): Promise<OrderWithItems> {
  return request('/orders', { method: 'POST', body: JSON.stringify(body) });
}

/** In-house stays for a room, for staff to confirm the guest before ordering. */
export function lookupStays(propertyId: string, roomNumber: string): Promise<StayLookupResponse> {
  return request(`/stays/lookup?propertyId=${q(propertyId)}&roomNumber=${q(roomNumber)}`);
}

/** HAIP folio posts with their orders. By default only those that need a manager. */
export function listOutbox(propertyId: string, query: OutboxQuery = {}): Promise<OutboxEntry[]> {
  const params = new URLSearchParams({ propertyId });
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  return request(`/outbox?${params.toString()}`);
}

/** Send it to HAIP again (the same charge id, so HAIP won't post it twice). */
export function retryOutbox(propertyId: string, id: string, note?: string): Promise<Omit<OutboxEntry, 'order'>> {
  const body = note?.trim() ? { note: note.trim() } : {};
  return request(`/outbox/${q(id)}/retry?propertyId=${q(propertyId)}`, { method: 'POST', body: JSON.stringify(body) });
}

/** Close it without sending: how it was resolved, and why. */
export function resolveOutbox(propertyId: string, id: string, body: ResolveOutboxBody): Promise<Omit<OutboxEntry, 'order'>> {
  return request(`/outbox/${q(id)}/resolve?propertyId=${q(propertyId)}`, { method: 'POST', body: JSON.stringify(body) });
}

export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}
