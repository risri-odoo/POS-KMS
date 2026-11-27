import { redisUrl } from '../common/runtime-config.js';

export const HAIP_CONFIG = Symbol('HAIP_CONFIG');

export interface HaipConfig {
  /** e.g. http://localhost:3000/api/v1 (no trailing slash). */
  apiUrl: string;
  /** Connect API key bound to ONE HAIP property. Never log or return it. */
  apiKey: string | undefined;
  /** The property the key belongs to; rows for any other property are not posted. */
  propertyId: string | undefined;
  /** IANA zone used for the folio service date. */
  timezone: string;
  redisUrl: string;
  /** False when there is no key (or the config is unusable): outbox rows still get written. */
  enabled: boolean;
  /** Why the bridge is disabled, for the startup warning. */
  disabledReason: string | undefined;
}

/** Development defaults. In production HAIP_API_URL and REDIS_URL must be set when a key is (runtime-config.ts). */
const DEFAULTS = {
  apiUrl: 'http://localhost:3000/api/v1',
  timezone: 'America/New_York',
};

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function loadHaipConfig(env: NodeJS.ProcessEnv = process.env): HaipConfig {
  const apiKey = env['HAIP_API_KEY']?.trim() || undefined;
  const timezone = env['HAIP_TIMEZONE']?.trim() || DEFAULTS.timezone;

  let disabledReason: string | undefined;
  if (!apiKey) disabledReason = 'HAIP_API_KEY is not set';
  else if (!isValidTimeZone(timezone)) disabledReason = `HAIP_TIMEZONE "${timezone}" is not a valid IANA time zone`;

  return {
    apiUrl: (env['HAIP_API_URL']?.trim() || DEFAULTS.apiUrl).replace(/\/+$/, ''),
    apiKey,
    propertyId: env['HAIP_PROPERTY_ID']?.trim() || undefined,
    timezone,
    // Only used when the bridge is on; production without a key needs no Redis.
    redisUrl: apiKey ? redisUrl(env) : env['REDIS_URL']?.trim() || 'redis://localhost:6380',
    enabled: disabledReason === undefined,
    disabledReason,
  };
}

/** BullMQ/ioredis connection options from a redis:// or rediss:// URL. */
export function redisConnectionOptions(redisUrl: string) {
  const url = new URL(redisUrl);
  const dbPath = url.pathname.replace(/^\//, '');
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: dbPath ? Number(dbPath) : undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
