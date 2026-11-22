import { pgTable, pgEnum, uuid, varchar, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { orders } from './orders.js';

export const outboxStatus = pgEnum('outbox_status', ['pending', 'posted', 'failed', 'needs_attention']);

/**
 * Why a row is parked. Replaces matching HAIP's error text (Phase 1 step 3).
 * - no_in_house_guest: HAIP said the room had no in-house guest. Never re-sent by room.
 * - stay_ended: the bound stay checked out or vanished before posting.
 * - needs_verification: no single in-house stay to bind an unverified order to.
 * - wrong_property: the row's property isn't the one the HAIP key belongs to.
 * - haip_rejected: any other 4xx from HAIP.
 */
export const parkedReason = pgEnum('parked_reason', [
  'no_in_house_guest',
  'stay_ended',
  'needs_verification',
  'wrong_property',
  'haip_rejected',
]);

export const haipPostOutbox = pgTable(
  'haip_post_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull(),
    orderId: uuid('order_id').notNull().references(() => orders.id),
    // Deterministic from the order id. Never regenerate. HAIP dedupes on this.
    vendorTxnId: varchar('vendor_txn_id', { length: 120 }).notNull(),
    status: outboxStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    haipChargeId: varchar('haip_charge_id', { length: 64 }),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    // Copied from the order on delivery, or attached when the worker verifies an unverified order.
    haipReservationId: uuid('haip_reservation_id'),
    haipFolioId: uuid('haip_folio_id'),
    parkedReason: parkedReason('parked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    vendorTxnUnique: uniqueIndex('haip_post_outbox_property_vendor_unique').on(t.propertyId, t.vendorTxnId),
    statusIdx: index('haip_post_outbox_status_idx').on(t.propertyId, t.status),
  }),
);