// 5181 = kitchen display (apps/kms), 5180 = POS (apps/pos).
const DEFAULT_ORIGINS = 'http://localhost:5181,http://127.0.0.1:5181,http://localhost:5180,http://127.0.0.1:5180';

/**
 * Browser origins allowed to call the API and open a socket. Shared by
 * app.enableCors (HTTP) and the kitchen gateway (Socket.IO) so they can't drift.
 * Env: CORS_ORIGINS, comma separated.
 */
export function getAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env['CORS_ORIGINS']?.trim() || DEFAULT_ORIGINS;
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}
