/**
 * Swagger UI at /docs: development only (INTEGRATION_DESIGN.md §8.4). It lists every
 * route and its inputs, so it is never served when NODE_ENV=production (where staff
 * login is always on; auth.config.ts refuses to start otherwise).
 */
export function swaggerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['NODE_ENV']?.trim() !== 'production';
}
