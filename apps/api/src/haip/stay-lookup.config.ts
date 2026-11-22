import { Logger } from '@nestjs/common';
import { demoStays, FakeStayLookup } from './fake-stay-lookup.js';
import { NotConfiguredStayLookup, type StayLookup } from './stay-lookup.js';

export type StayLookupMode = 'not_configured' | 'fake';

const MODES: readonly StayLookupMode[] = ['fake'];

/**
 * Reads HAIP_STAY_LOOKUP. Throws (so the API refuses to start) when the value is
 * unknown, or when the fake is asked for in production.
 * - unset or empty: not configured. Staff orders go through the unverified flow.
 * - fake: in-memory demo stays. Development and tests only.
 * The real HAIP adapter arrives in Phase 1 step 7.
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

/** Provider factory used by HaipModule; throwing here stops Nest from starting. */
export function createStayLookup(env: NodeJS.ProcessEnv = process.env, logger = new Logger('StayLookup')): StayLookup {
  const mode = loadStayLookupMode(env);
  if (mode === 'fake') {
    logger.warn('Stay lookup uses FAKE demo stays (HAIP_STAY_LOOKUP=fake). Never use this in production.');
    return new FakeStayLookup(demoStays());
  }
  logger.warn('Stay lookup is not configured (HAIP_STAY_LOOKUP unset): staff orders will be unverified.');
  return new NotConfiguredStayLookup();
}
