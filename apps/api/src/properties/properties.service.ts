import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { properties } from '@stayx/database';
import { DRIZZLE, type Db } from '../database/database.module.js';

export type PropertyRecord = typeof properties.$inferSelect;

export const PROPERTY_DIRECTORY = Symbol('PROPERTY_DIRECTORY');

/** Looks up ACTIVE hotels. Unknown and inactive are both null: callers treat them alike. */
export interface PropertyDirectory {
  find(id: string): Promise<PropertyRecord | null>;
}

/** The only environment variables a property row may name for its HAIP key. */
export const HAIP_KEY_ENV_PATTERN = /^HAIP_KEY_[A-Z0-9_]+$/;

export type HaipKeyLookup = { ok: true; apiKey: string } | { ok: false; reason: string };

/**
 * This hotel's HAIP folio-inbound key, read from the environment variable its row names.
 * Refuses names outside HAIP_KEY_*, so a row can never point the bridge at another
 * secret (e.g. DATABASE_URL). The reason never contains the key.
 */
export function haipApiKeyFor(property: Pick<PropertyRecord, 'name' | 'haipApiKeyEnv'>, env: NodeJS.ProcessEnv = process.env): HaipKeyLookup {
  const name = property.haipApiKeyEnv;
  if (!name) return { ok: false, reason: `${property.name} has no HAIP key configured` };
  if (!HAIP_KEY_ENV_PATTERN.test(name)) return { ok: false, reason: `${property.name}: "${name}" is not a HAIP_KEY_* variable` };
  const apiKey = env[name]?.trim();
  if (!apiKey) return { ok: false, reason: `${property.name}: ${name} is not set` };
  return { ok: true, apiKey };
}

/** How long a lookup (found or not) is reused. A hotel added by script is seen within this time. */
export const PROPERTY_CACHE_MS = 30_000;

@Injectable()
export class PropertiesService implements PropertyDirectory {
  private readonly cache = new Map<string, { record: PropertyRecord | null; until: number }>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject('PROPERTY_CACHE_MS') private readonly cacheMs: number = PROPERTY_CACHE_MS,
    @Inject('NOW') private readonly now: () => number = Date.now,
  ) {}

  async find(id: string): Promise<PropertyRecord | null> {
    const hit = this.cache.get(id);
    if (hit && hit.until > this.now()) return hit.record;
    const [row] = await this.db.select().from(properties).where(eq(properties.id, id));
    const record = row && row.active ? row : null;
    this.cache.set(id, { record, until: this.now() + this.cacheMs });
    return record;
  }
}
