import { defineConfig } from 'drizzle-kit';

// Migrations against production must name the database explicitly: the default is the
// local docker-compose database with development credentials.
const url = process.env.DATABASE_URL?.trim();
if (process.env.NODE_ENV === 'production') {
  if (!url) throw new Error('DATABASE_URL must be set when NODE_ENV=production (no default for migrations)');
  if (/\/\/stayx:stayx@/.test(url)) throw new Error('DATABASE_URL uses the development credentials (stayx:stayx); not allowed when NODE_ENV=production');
}

export default defineConfig({
  schema: './src/schema/*.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: url || 'postgres://stayx:stayx@localhost:5433/stayx_pos',
  },
});