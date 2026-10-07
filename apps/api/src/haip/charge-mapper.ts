import { Decimal } from 'decimal.js';

/** HAIP folio-inbound request body. No propertyId: the API key is bound to one property. */
export interface InboundCharge {
  roomNumber: string;
  type: 'food_beverage';
  amount: string;
  currencyCode: string;
  vendorTxnId: string;
  description: string;
  serviceDate: string;
}

/** The order fields the mapper needs. */
export interface ChargeableOrder {
  orderNumber: string;
  roomNumber: string;
  subtotal: string;
  currencyCode: string;
  deliveredAt: Date | null;
  updatedAt: Date;
  items: readonly unknown[];
}

const MAX_DESCRIPTION = 255;

/** Deterministic HAIP idempotency key for an order. Never regenerate it. */
export function vendorTxnIdFor(orderId: string): string {
  return `stayx-rs-${orderId}`;
}

/** Calendar date (YYYY-MM-DD) of `instant` in an IANA time zone. */
export function calendarDateIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Map a delivered order to a HAIP folio charge. `amount` is the PRE-TAX
 * subtotal: HAIP applies tax itself, so adding it here would double-tax.
 */
export function buildInboundCharge(order: ChargeableOrder, vendorTxnId: string, timeZone: string): InboundCharge {
  const description = `Room service ${order.orderNumber} (${order.items.length} item lines)`;
  return {
    roomNumber: order.roomNumber,
    type: 'food_beverage',
    amount: new Decimal(order.subtotal).toFixed(2),
    currencyCode: order.currencyCode,
    vendorTxnId,
    description: description.slice(0, MAX_DESCRIPTION),
    // deliveredAt is always set for delivered orders; updatedAt is a defensive fallback.
    serviceDate: calendarDateIn(order.deliveredAt ?? order.updatedAt, timeZone),
  };
}

export type ChargeOutcome = 'posted' | 'terminal' | 'retry';

/**
 * How to treat a HAIP response.
 * - posted: 2xx.
 * - terminal: a human must fix something (room not in-house, validation, bad
 *   or revoked key, wrong URL). Retrying unchanged would fail the same way.
 * - retry: transient (5xx, 429, 408, timeout, network). NOTE: on a RETRY a 5xx
 *   is ambiguous, because HAIP answers a duplicate vendorTxnId with 500.
 */
export function classifyResponse(result: number | 'timeout' | 'network'): ChargeOutcome {
  if (result === 'timeout' || result === 'network') return 'retry';
  if (result >= 200 && result < 300) return 'posted';
  if (result >= 500 || result === 429 || result === 408) return 'retry';
  // 400, 401, 403, 404, 422 and any other unexpected status: needs a human.
  return 'terminal';
}
