/**
 * API shapes as they arrive over JSON. Defined locally on purpose: the POS
 * never imports server code. Dates and money are strings.
 */

export const ORDER_STATUSES = ['placed', 'accepted', 'preparing', 'ready', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface MenuItem {
  id: string;
  propertyId: string;
  category: string | null;
  name: string;
  description: string | null;
  price: string;
  currencyCode: string;
  isAvailable: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

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

/** POST /orders response and the order.created payload. */
export interface OrderWithItems extends Order {
  items: OrderItem[];
}

/** A recent-orders entry: a row, with items when we have seen them. */
export type FeedOrder = Order & { items?: OrderItem[] };

export interface RoomAck {
  ok: boolean;
  room?: string;
  error?: string;
}

/** POST /orders body. Deliberately has no price fields: the server prices orders. */
export type PlaceOrderBody = {
  propertyId: string;
  roomNumber: string;
  items: { menuItemId: string; quantity: number; notes?: string }[];
  notes?: string;
  placedBy: 'pos';
} & (
  /** The guest staff confirmed from GET /stays/lookup (re-checked by the server). */
  | { reservationId: string; confirmedGuestName: string }
  /** Staff ticked the "Unverified" warning (lookup unavailable or not set up). */
  | { unverified: true }
);

/** GET /stays/lookup. Guests are first name + surname initial only. */
export interface PublicGuest {
  firstName: string;
  lastInitial: string;
  displayName: string;
}

export interface PublicStay {
  reservationId: string;
  roomNumber: string;
  departureDate: string;
  guests: PublicGuest[];
}

export type StayLookupResponse =
  | { status: 'found'; stays: PublicStay[] }
  | { status: 'none' }
  | { status: 'unavailable' }
  | { status: 'not_configured' };

export interface CreateMenuItemBody {
  propertyId: string;
  name: string;
  price: string;
  currencyCode: string;
  category?: string;
  description?: string;
  sortOrder?: number;
}

export interface UpdateMenuItemBody {
  name?: string;
  price?: string;
  category?: string | null;
  isAvailable?: boolean;
}
