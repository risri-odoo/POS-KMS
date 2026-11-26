import { API_URL } from './config.js';
import { authHooks } from './auth/auth-hooks.js';
import type {
  CreateMenuItemBody,
  MenuItem,
  Order,
  OrderWithItems,
  PlaceOrderBody,
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

export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}
