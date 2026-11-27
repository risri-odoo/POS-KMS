import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, boolean, timestamp, char, check } from 'drizzle-orm/pg-core';

/**
 * The hotels POS serves (AUDIT.md item 4). The id IS the HAIP property id: staff tokens
 * carry HAIP property ids in property_ids, so there is nothing to translate.
 * Managed with scripts/property.mjs (no API or screen yet).
 */
export const properties = pgTable('properties', {
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  /** ISO 4217, e.g. USD. Menu items and orders must use it (Step 5). */
  currencyCode: char('currency_code', { length: 3 }).notNull(),
  /** IANA zone for the folio service date, e.g. America/New_York. */
  timezone: varchar('timezone', { length: 64 }).notNull(),
  /**
   * The NAME of the environment variable holding this hotel's HAIP folio-inbound key,
   * e.g. HAIP_KEY_DEMO. Never the key itself. Must start with HAIP_KEY_. Null: the hotel
   * isn't posted to HAIP (its charges park for a person).
   */
  haipApiKeyEnv: varchar('haip_api_key_env', { length: 100 }),
  /** Inactive hotels are refused like unknown ones (404). */
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // The same rules as scripts/property.mjs, so a hand-written INSERT can't break them.
  check('properties_currency_code_format', sql`${t.currencyCode} ~ '^[A-Z]{3}$'`),
  check('properties_haip_api_key_env_format', sql`${t.haipApiKeyEnv} IS NULL OR ${t.haipApiKeyEnv} ~ '^HAIP_KEY_[A-Z0-9_]+$'`),
]);
