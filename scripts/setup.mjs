#!/usr/bin/env node
// One-time local setup: install, start Postgres + Redis, wait for Postgres,
// build the shared database package, apply migrations.
// Run with:  pnpm run setup   (NOT `pnpm setup`, which is a built-in pnpm command)
// Works on Windows PowerShell, macOS and Linux. No dependencies.
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const POSTGRES_WAIT_MS = 30_000;
const POSTGRES_PORT = 5433;

function step(title) {
  console.log(`\n▶ ${title}`);
}

/** Run a command in the repo root, streaming output. Returns the exit code. */
function run(command, args, { quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: quiet ? 'ignore' : 'inherit',
    // Needed on Windows so `pnpm` / `docker` resolve to their .cmd/.exe shims.
    shell: isWindows,
  });
  return result.status ?? 1;
}

function runOrExit(command, args, hint) {
  const code = run(command, args);
  if (code !== 0) {
    console.error(`\n✖ "${[command, ...args].join(' ')}" failed (exit ${code}).${hint ? `\n  ${hint}` : ''}`);
    process.exit(code);
  }
}

function canConnect(port) {
  return new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(false));
  });
}

/**
 * Ready = the host port accepts TCP AND pg_isready succeeds over TCP inside the
 * container. (During first-time init Postgres runs a temporary socket-only
 * server, so a plain pg_isready can say "ready" too early.)
 */
async function waitForPostgres() {
  const deadline = Date.now() + POSTGRES_WAIT_MS;
  while (Date.now() < deadline) {
    const portOpen = await canConnect(POSTGRES_PORT);
    if (
      portOpen &&
      run('docker', ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-h', '127.0.0.1', '-U', 'stayx', '-d', 'stayx_pos'], { quiet: true }) === 0
    ) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

step('Checking Docker');
if (run('docker', ['info'], { quiet: true }) !== 0) {
  console.error('✖ Docker is not running. Start Docker Desktop, wait until it says "running", then run `pnpm run setup` again.');
  process.exit(1);
}

step('Installing dependencies (pnpm install)');
runOrExit('pnpm', ['install'], 'If pnpm is missing, run `corepack enable` first.');

step('Starting Postgres and Redis (docker compose up -d)');
runOrExit('pnpm', ['docker:up'], `Is something else using port ${POSTGRES_PORT} or 6380? See README → Troubleshooting.`);

step(`Waiting for Postgres on localhost:${POSTGRES_PORT} (up to ${POSTGRES_WAIT_MS / 1000}s)`);
if (!(await waitForPostgres())) {
  console.error(`✖ Postgres did not become ready within ${POSTGRES_WAIT_MS / 1000}s. Check \`docker compose logs postgres\`.`);
  process.exit(1);
}
console.log('  Postgres is ready.');

step('Building the shared database package');
runOrExit('pnpm', ['--filter', '@stayx/database', 'run', 'build']);

step('Applying database migrations (pnpm db:migrate)');
runOrExit('pnpm', ['db:migrate']);

console.log(`
✔ Setup complete.

Next:
  pnpm dev:all      start the API, kitchen display and POS (Ctrl+C stops all three)
  pnpm seed:demo    in a second terminal, once the API is up: add a demo menu

Then open http://localhost:5174 (POS) and http://localhost:5173 (kitchen).`);
