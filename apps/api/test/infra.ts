import net from 'node:net';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

/**
 * The throwaway database and Redis database for the integration test. Uses the local
 * docker-compose containers (pos-postgres-1 on 5433, pos-redis-1 on 6380).
 */
export const PG_SERVER = process.env['E2E_PG_SERVER'] ?? 'postgres://stayx:stayx@localhost:5433';
export const E2E_DATABASE = 'stayx_pos_e2e';
export const REDIS_HOST = '127.0.0.1';
export const REDIS_PORT = 6380;
export const REDIS_DB = 3;
const MIGRATIONS = fileURLToPath(new URL('../../../packages/database/migrations', import.meta.url));

/** Drop (if left over) and create the throwaway database, then apply every migration. */
export async function createDatabase(): Promise<postgres.Sql> {
  const admin = postgres(`${PG_SERVER}/postgres`, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${E2E_DATABASE} with (force)`);
  await admin.unsafe(`create database ${E2E_DATABASE}`);
  await admin.end();
  const sql = postgres(`${PG_SERVER}/${E2E_DATABASE}`, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
  return sql;
}

export async function dropDatabase(sql: postgres.Sql): Promise<void> {
  await sql.end({ timeout: 5 });
  const admin = postgres(`${PG_SERVER}/postgres`, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${E2E_DATABASE} with (force)`);
  await admin.end();
}

/** One Redis command on database 3 over the wire protocol (no client package needed). */
export function redis(...args: string[]): Promise<string | number | null> {
  const encode = (parts: string[]) => `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: REDIS_HOST, port: REDIS_PORT });
    let buffer = '';
    socket.on('data', (d) => {
      buffer += d.toString();
      // Two replies: SELECT's +OK, then the command's.
      const lines = buffer.split('\r\n');
      if (lines.length < 3) return;
      const reply = lines.slice(1).join('\r\n');
      socket.end();
      if (reply.startsWith('-')) return reject(new Error(reply.slice(1, reply.indexOf('\r\n'))));
      if (reply.startsWith(':')) return resolve(Number(reply.slice(1, reply.indexOf('\r\n'))));
      if (reply.startsWith('+')) return resolve(reply.slice(1, reply.indexOf('\r\n')));
      if (reply.startsWith('$-1')) return resolve(null);
      if (reply.startsWith('$')) return resolve(reply.split('\r\n')[1] ?? null);
      resolve(reply);
    });
    socket.on('error', reject);
    socket.write(encode(['SELECT', String(REDIS_DB)]) + encode(args));
  });
}

export async function waitFor<T>(what: string, check: () => Promise<T | undefined | null | false>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
