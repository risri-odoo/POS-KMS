import { Logger } from '@nestjs/common';
import { demoStays, FakeStayLookup } from './fake-stay-lookup.js';
import { HaipStayLookup, type HaipStayLookupOptions } from './haip-stay-lookup.js';
import { NotConfiguredStayLookup, type StayLookup } from './stay-lookup.js';

export type StayLookupMode = 'not_configured' | 'fake' | 'haip';

const MODES: readonly StayLookupMode[] = ['fake', 'haip'];

/** The service-principal settings HAIP_STAY_LOOKUP=haip needs. */
const SP_VARS = ['HAIP_SP_TOKEN_URL', 'HAIP_SP_CLIENT_ID', 'HAIP_SP_CLIENT_SECRET'] as const;

/**
 * Reads HAIP_STAY_LOOKUP. Throws (so the API refuses to start) when the value is
 * unknown, when the fake is asked for in production, or when haip is missing settings.
 * - unset or empty: not configured. Staff orders are unverified; posting is unchanged.
 * - fake: in-memory demo stays. Development and tests only.
 * - haip: HAIP staff REST with a service principal (HaipStayLookup).
 */
export function loadStayLookupMode(env: NodeJS.ProcessEnv = process.env): StayLookupMode {
  const raw = env['HAIP_STAY_LOOKUP']?.trim().toLowerCase() ?? '';
  if (raw === '') return 'not_configured';
  if (!(MODES as readonly string[]).includes(raw)) {
    throw new Error(`HAIP_STAY_LOOKUP="${raw}" is not supported. Leave it unset, or use: ${MODES.join(', ')}`);
  }
  if (raw === 'fake' && env['NODE_ENV']?.trim().toLowerCase() === 'production') {
    throw new Error('HAIP_STAY_LOOKUP=fake is not allowed when NODE_ENV=production');
  }
  return raw as StayLookupMode;
}

/** Settings for HAIP_STAY_LOOKUP=haip. Never logs or returns the secret in an error. */
export function haipStayLookupOptions(env: NodeJS.ProcessEnv = process.env): HaipStayLookupOptions {
  const missing = SP_VARS.filter((name) => !env[name]?.trim());
  const apiUrl = (env['HAIP_STAFF_API_URL']?.trim() || env['HAIP_API_URL']?.trim() || '').replace(/\/+$/, '');
  if (!apiUrl) missing.unshift('HAIP_STAFF_API_URL' as never);
  if (missing.length > 0) throw new Error(`HAIP_STAY_LOOKUP=haip needs: ${missing.join(', ')}`);
  return {
    apiUrl,
    tokenUrl: env['HAIP_SP_TOKEN_URL']!.trim(),
    clientId: env['HAIP_SP_CLIENT_ID']!.trim(),
    clientSecret: env['HAIP_SP_CLIENT_SECRET']!.trim(),
  };
}

/** Provider factory used by HaipModule; throwing here stops Nest from starting. */
export function createStayLookup(env: NodeJS.ProcessEnv = process.env, logger = new Logger('StayLookup')): StayLookup {
  const mode = loadStayLookupMode(env);
  if (mode === 'fake') {
    logger.warn('Stay lookup uses FAKE demo stays (HAIP_STAY_LOOKUP=fake). Never use this in production.');
    return new FakeStayLookup(demoStays());
  }
  if (mode === 'haip') {
    const options = haipStayLookupOptions(env);
    logger.log(`Stay lookup uses HAIP staff REST at ${options.apiUrl} as client ${options.clientId}`);
    return new HaipStayLookup(options);
  }
  logger.warn('Stay lookup is not configured (HAIP_STAY_LOOKUP unset): staff orders will be unverified.');
  return new NotConfiguredStayLookup();
}
