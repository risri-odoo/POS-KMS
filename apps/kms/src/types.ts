/**
 * Order shapes as they arrive over JSON from the API. Defined locally on
 * purpose: the KMS never imports server code. Dates and money are strings.
 */

export const ORDER_STATUSES = ['placed', 'accepted', 'preparing', 'ready', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses shown on the board, in column order. */
export const ACTIVE_STATUSES = ['placed', 'accepted', 'preparing', 'ready'] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

export interface OrderItem {
  id: string;
  propertyId: string;
  orderId: string;
  menuItemId: string | null;
  name: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  notes: string | null;
  createdAt: string;
}

/** An order row: GET /orders and the order.status_changed payload (no items). */
export interface Order {
  id: string;
  propertyId: string;
  orderNumber: string;
  roomNumber: string;
  status: OrderStatus;
  subtotal: string;
  currencyCode: string;
  notes: string | null;
  placedBy: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET /orders/:id and the order.created payload. */
export interface OrderWithItems extends Order {
  items: OrderItem[];
}

export interface RoomAck {
  ok: boolean;
  room?: string;
  error?: string;
}

export function isActiveStatus(status: OrderStatus): status is ActiveStatus {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}
