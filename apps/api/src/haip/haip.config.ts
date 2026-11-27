import { redisUrl } from '../common/runtime-config.js';

export const HAIP_CONFIG = Symbol('HAIP_CONFIG');

export interface HaipConfig {
  /** e.g. http://localhost:3000/api/v1 (no trailing slash). */
  apiUrl: string;
  redisUrl: string;
  /**
   * HAIP_BRIDGE_ENABLED=true. Off: outbox rows are still written, nothing is sent. Each
   * hotel's key and timezone come from the properties table (AUDIT.md item 4).
   */
  enabled: boolean;
  /** Why the bridge is disabled, for the startup warning. */
  disabledReason: string | undefined;
}

/** Development default. In production HAIP_API_URL and REDIS_URL must be set when the bridge is on (runtime-config.ts). */
const DEFAULT_API_URL = 'http://localhost:3000/api/v1';

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function loadHaipConfig(env: NodeJS.ProcessEnv = process.env): HaipConfig {
  const flag = env['HAIP_BRIDGE_ENABLED']?.trim().toLowerCase();
  if (flag !== undefined && flag !== '' && flag !== 'true' && flag !== 'false') {
    throw new Error(`HAIP_BRIDGE_ENABLED must be true or false, got "${env['HAIP_BRIDGE_ENABLED']}"`);
  }
  const enabled = flag === 'true';
  return {
    apiUrl: (env['HAIP_API_URL']?.trim() || DEFAULT_API_URL).replace(/\/+$/, ''),
    // Only used when the bridge is on; production with it off needs no Redis.
    redisUrl: enabled ? redisUrl(env) : env['REDIS_URL']?.trim() || 'redis://localhost:6380',
    enabled,
    disabledReason: enabled ? undefined : 'HAIP_BRIDGE_ENABLED is not true',
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
