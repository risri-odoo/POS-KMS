import { pgTable, pgEnum, uuid, varchar, text, numeric, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { menuItems } from './menu.js';

export const orderStatus = pgEnum('order_status', [
  'placed',
  'accepted',
  'preparing',
  'ready',
  'delivered',
  'cancelled',
]);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull(),
    orderNumber: varchar('order_number', { length: 30 }).notNull(),
    roomNumber: varchar('room_number', { length: 20 }).notNull(),
    status: orderStatus('status').notNull().default('placed'),
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    notes: text('notes'),
    placedBy: varchar('placed_by', { length: 100 }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderNumberUnique: uniqueIndex('orders_property_order_number_unique').on(t.propertyId, t.orderNumber),
    statusIdx: index('orders_property_status_idx').on(t.propertyId, t.status),
  }),
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull(),
    orderId: uuid('order_id').notNull().references(() => orders.id),
    menuItemId: uuid('menu_item_id').references(() => menuItems.id),
    // Snapshots, so later menu edits never change past orders
    name: varchar('name', { length: 255 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    quantity: integer('quantity').notNull(),
    lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index('order_items_order_idx').on(t.propertyId, t.orderId),
  }),
);