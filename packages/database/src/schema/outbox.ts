import { pgTable, pgEnum, uuid, varchar, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { orders } from './orders.js';

/**
 * - pending: waiting for the worker. posted: on the guest's folio in HAIP (by the worker,
 *   or by staff and recorded with resolution_type posted_manually).
 * - failed / needs_attention: a person has to deal with it (Outbox/Errors screen).
 * - resolved: closed by a person WITHOUT a folio charge (collected otherwise, written off,
 *   duplicate or error). Never counts as posted; the worker never picks it up.
 */
export const outboxStatus = pgEnum('outbox_status', ['pending', 'posted', 'failed', 'needs_attention', 'resolved']);

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

/**
 * How a manager closed a row that needed attention (required with Resolve).
 * - posted_manually: the charge is on the folio, added in HAIP by staff (status posted).
 * - collected_otherwise: paid another way, e.g. at the front desk (status resolved).
 * - written_off: not charged to anyone (status resolved).
 * - duplicate_or_error: the order shouldn't have been charged at all (status resolved).
 */
export const resolutionType = pgEnum('resolution_type', [
  'posted_manually',
  'collected_otherwise',
  'written_off',
  'duplicate_or_error',
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
    // Set by Resolve (Outbox/Errors screen). Who comes from the staff token.
    resolutionType: resolutionType('resolution_type'),
    resolutionNote: text('resolution_note'),
    resolvedBy: varchar('resolved_by', { length: 100 }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    // The last manual Retry (the note is optional).
    lastRetryBy: varchar('last_retry_by', { length: 100 }),
    lastRetryAt: timestamp('last_retry_at', { withTimezone: true }),
    lastRetryNote: text('last_retry_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    vendorTxnUnique: uniqueIndex('haip_post_outbox_property_vendor_unique').on(t.propertyId, t.vendorTxnId),
    statusIdx: index('haip_post_outbox_status_idx').on(t.propertyId, t.status),
  }),
);