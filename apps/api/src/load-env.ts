import { fileURLToPath } from 'node:url';

/**
 * Load pos/.env into process.env with Node's built-in loader (no dotenv).
 * Imported FIRST in main.ts: ESM evaluates imports before the importing module
 * runs, and some modules (e.g. the gateway's CORS list) read env at import time.
 * Variables already set in the environment win. A missing file is fine.
 */
const envPath = fileURLToPath(new URL('../../../.env', import.meta.url)); // dist|src → apps/api → apps → pos
try {
  process.loadEnvFile(envPath);
} catch {
  // No .env file: rely on the real environment.
}
