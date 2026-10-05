import { pgTable, pgEnum, uuid, varchar, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { orders } from './orders.js';

export const outboxStatus = pgEnum('outbox_status', ['pending', 'posted', 'failed', 'needs_attention']);

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    vendorTxnUnique: uniqueIndex('haip_post_outbox_property_vendor_unique').on(t.propertyId, t.vendorTxnId),
    statusIdx: index('haip_post_outbox_status_idx').on(t.propertyId, t.status),
  }),
);