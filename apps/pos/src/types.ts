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

/** GET /outbox/summary (managers): charges needing attention. */
export interface OutboxSummary {
  needsAttention: number;
  failed: number;
  stuck: number;
  total: number;
  oldestAt: string | null;
  stuckAfterMinutes: number;
  bridgeEnabled: boolean;
}

/** GET /properties/current: what the screen needs about its hotel. */
export interface PublicProperty {
  id: string;
  name: string;
  currencyCode: string;
  timezone: string;
}

/** POST /menu-items. No currency: the server uses the hotel's (AUDIT.md item 5). */
export interface CreateMenuItemBody {
  propertyId: string;
  name: string;
  price: string;
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

/** HAIP folio post statuses (GET /outbox). resolved: closed by a manager without a folio charge. */
export type OutboxStatus = 'pending' | 'posted' | 'failed' | 'needs_attention' | 'resolved';
export type ParkedReason = 'no_in_house_guest' | 'stay_ended' | 'needs_verification' | 'wrong_property' | 'haip_rejected';
export type ResolutionType = 'posted_manually' | 'collected_otherwise' | 'written_off' | 'duplicate_or_error';

/** GET /outbox: one HAIP folio post with the order behind it. */
export interface OutboxEntry {
  id: string;
  propertyId: string;
  orderId: string;
  vendorTxnId: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  nextRetryAt: string | null;
  haipChargeId: string | null;
  postedAt: string | null;
  parkedReason: ParkedReason | null;
  resolutionType: ResolutionType | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  lastRetryBy: string | null;
  lastRetryAt: string | null;
  lastRetryNote: string | null;
  createdAt: string;
  updatedAt: string;
  /** Whether the server would accept Retry now (e.g. "Hotel not set up" once its key is set). */
  retryAllowed: boolean;
  /** Waiting to post longer than the stuck threshold (shown under "Needs attention"). */
  stuck: boolean;
  order: {
    orderNumber: string;
    roomNumber: string;
    subtotal: string;
    currencyCode: string;
    placedBy: string | null;
    deliveredAt: string | null;
    verificationStatus: 'verified' | 'unverified' | null;
    guestName: string | null;
  } | null;
}

export interface OutboxQuery {
  view?: 'attention' | 'all';
  parkedReason?: ParkedReason;
  resolutionType?: ResolutionType;
}

/** POST /outbox/:id/resolve. haipChargeId only with posted_manually. */
export interface ResolveOutboxBody {
  resolutionType: ResolutionType;
  note: string;
  haipChargeId?: string;
}
