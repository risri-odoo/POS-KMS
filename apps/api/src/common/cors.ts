import { corsOrigins } from './runtime-config.js';

/**
 * Browser origins allowed to call the API and open a socket. Shared by
 * app.enableCors (HTTP) and the kitchen gateway (Socket.IO) so they can't drift.
 * Env: CORS_ORIGINS, comma separated. Localhost defaults in development only.
 */
export function getAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return corsOrigins(env);
}

/**
 * The same rule as a cors `origin` callback, read when a request arrives rather than when
 * the module is imported: decorators run at import, before main.ts can report missing
 * production settings as one list. Requests without an Origin (not from a browser) pass,
 * as with a plain list.
 */
export function allowOrigin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void): void {
  try {
    callback(null, !origin || getAllowedOrigins().includes(origin));
  } catch (error) {
    callback(error as Error);
  }
}
