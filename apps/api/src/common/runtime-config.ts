/**
 * Settings that have a convenient default for local development but must be set
 * explicitly in production (AUDIT.md item 11): no default database credentials,
 * no localhost guesses. The API refuses to start instead of running half-configured.
 */

/** The docker-compose development credentials. Never accepted in production. */
const DEV_DATABASE_URL = 'postgres://stayx:stayx@localhost:5433/stayx_pos';
const DEV_REDIS_URL = 'redis://localhost:6380';
/** 5181 = kitchen display (apps/kms), 5180 = POS (apps/pos). */
const DEV_CORS_ORIGINS = 'http://localhost:5181,http://127.0.0.1:5181,http://localhost:5180,http://127.0.0.1:5180';

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['NODE_ENV']?.trim() === 'production';
}

/** The value of `name`; in development the default if unset; in production unset is an error. */
function setting(env: NodeJS.ProcessEnv, name: string, devDefault: string): string {
  const value = env[name]?.trim();
  if (value) return value;
  if (isProduction(env)) throw new Error(`${name} must be set when NODE_ENV=production (there is no production default)`);
  return devDefault;
}

/** True when the URL logs in with the development user and password stayx:stayx. */
function usesDevCredentials(url: string): boolean {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.username) === 'stayx' && decodeURIComponent(u.password) === 'stayx';
  } catch {
    return false;
  }
}

export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = setting(env, 'DATABASE_URL', DEV_DATABASE_URL);
  if (isProduction(env) && usesDevCredentials(url)) {
    throw new Error('DATABASE_URL uses the development credentials (stayx:stayx); not allowed when NODE_ENV=production');
  }
  return url;
}

/** Redis is only needed by the HAIP bridge (queue and worker). */
export function redisUrl(env: NodeJS.ProcessEnv = process.env): string {
  return setting(env, 'REDIS_URL', DEV_REDIS_URL);
}

export function corsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return setting(env, 'CORS_ORIGINS', DEV_CORS_ORIGINS)
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

/**
 * Checks every production-only rule at once, before anything connects, so a bad
 * deployment fails at start with one clear list instead of on the first request.
 * Returns the problems; main.ts throws if there are any.
 */
export function productionConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!isProduction(env)) return [];
  const problems: string[] = [];
  const check = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      problems.push((error as Error).message);
    }
  };
  check(() => databaseUrl(env));
  check(() => corsOrigins(env));
  // The HAIP bridge is on when a key is set; then it needs Redis and HAIP's real address.
  if (env['HAIP_API_KEY']?.trim()) {
    check(() => redisUrl(env));
    if (!env['HAIP_API_URL']?.trim()) problems.push('HAIP_API_URL must be set when NODE_ENV=production and HAIP_API_KEY is set');
  }
  return problems;
}
