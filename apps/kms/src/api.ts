import { API_URL } from './config.js';
import { authHooks } from '@stayx/web-common/auth';
import { ACTIVE_STATUSES, isActiveStatus, type Order, type OrderStatus, type OrderWithItems } from './types.js';

/** An HTTP error from the API, keeping the status so callers can react to 400/409. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const SIGNED_OUT_MESSAGE = 'Signed out: sign in again to update orders';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hooks = authHooks();
  const token = hooks ? await hooks.getToken().catch(() => null) : null;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 401 && hooks) {
    // The board keeps showing; AuthGate shows "Sign in again" (§8.6).
    hooks.sessionEnded();
    throw new ApiError(401, SIGNED_OUT_MESSAGE);
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body.message) message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    } catch {
      // non-JSON error body: keep the status line
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const q = encodeURIComponent;

export function listOrders(propertyId: string, status: OrderStatus): Promise<Order[]> {
  return request(`/orders?propertyId=${q(propertyId)}&status=${q(status)}`);
}

export function getOrder(propertyId: string, id: string): Promise<OrderWithItems> {
  return request(`/orders/${q(id)}?propertyId=${q(propertyId)}`);
}

export function updateOrderStatus(propertyId: string, id: string, status: OrderStatus): Promise<Order> {
  return request(`/orders/${q(id)}/status?propertyId=${q(propertyId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

/**
 * Load every active order with its items. The list endpoint takes one status
 * and returns no items, so: one list call per active status (in parallel),
 * then one detail call per order (in parallel). The detail response is the
 * freshest record, so an order that finished in between is dropped.
 */
export async function fetchActiveBoard(propertyId: string): Promise<OrderWithItems[]> {
  const lists = await Promise.all(ACTIVE_STATUSES.map((status) => listOrders(propertyId, status)));
  // An order that moved between two list calls can show up twice; ids dedupe it.
  const ids = [...new Set(lists.flat().map((o) => o.id))];
  const details = await Promise.all(ids.map((id) => getOrder(propertyId, id)));
  return details.filter((o) => isActiveStatus(o.status));
}
