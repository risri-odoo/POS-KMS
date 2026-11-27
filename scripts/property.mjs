#!/usr/bin/env node
// Manage the hotels POS serves (properties table, AUDIT.md item 4). No API or screen yet.
//
//   node scripts/property.mjs list
//   node scripts/property.mjs add --id <HAIP property uuid> --name "Demo hotel" --currency USD \
//        --timezone America/New_York [--key-env HAIP_KEY_DEMO] [--if-missing] [--dry-run]
//   node scripts/property.mjs update --id <uuid> [--name ...] [--currency ...] [--timezone ...]
//        [--key-env HAIP_KEY_X | --key-env none] [--active true|false] [--dry-run]
//   node scripts/property.mjs check-menu-currency   (read-only: menu items whose currency isn't
//        their hotel's, or whose hotel isn't registered; orders with them are refused)
//
// --key-env is the NAME of the environment variable that holds the hotel's HAIP
// folio-inbound key (must start with HAIP_KEY_). The key itself is never stored, read or
// printed here; `list` only says whether that variable is set in this shell.
// Database: DATABASE_URL (development default: the docker-compose database; required
// when NODE_ENV=production). --dry-run prints the SQL and connects to nothing.
// add --if-missing does nothing if the hotel already exists (used by pnpm run setup).
//
// Use the SAME --currency and --timezone that HAIP has for the property (its properties
// record), e.g. --currency INR --timezone Asia/Kolkata for our Ahmedabad hotels. A
// mismatch makes menu prices, orders and folio charges disagree. The demo hotel uses USD
// and America/New_York, like HAIP's seeded demo property (haip seed.ts).
import { createRequire } from 'node:module';

const DEV_DATABASE_URL = 'postgres://stayx:stayx@localhost:5433/stayx_pos';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;
const KEY_ENV = /^HAIP_KEY_[A-Z0-9_]+$/;

function fail(message) {
  console.error(`property: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) fail(`unexpected argument "${arg}"`);
    const name = arg.slice(2);
    if (name === 'dry-run' || name === 'if-missing') {
      options[name === 'dry-run' ? 'dryRun' : 'ifMissing'] = true;
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) fail(`--${name} needs a value`);
    options[name] = value;
    i++;
  }
  return { command, options };
}

const isTimeZone = (tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Checks and normalises the given fields; `required` lists those that must be present. */
function validate(options, required) {
  const allowed = new Set(['id', 'name', 'currency', 'timezone', 'key-env', 'active', 'dryRun', 'ifMissing']);
  for (const key of Object.keys(options)) if (!allowed.has(key)) fail(`unknown option --${key}`);
  for (const key of required) if (options[key] === undefined) fail(`--${key} is required`);
  const out = {};
  if (options.id !== undefined) {
    if (!UUID.test(options.id)) fail('--id must be the HAIP property UUID');
    out.id = options.id.toLowerCase();
  }
  if (options.name !== undefined) {
    const name = options.name.trim();
    if (name.length < 1 || name.length > 200) fail('--name must be 1 to 200 characters');
    out.name = name;
  }
  if (options.currency !== undefined) {
    const currency = options.currency.trim().toUpperCase();
    if (!CURRENCY.test(currency)) fail('--currency must be a three-letter ISO 4217 code, e.g. USD');
    out.currency_code = currency;
  }
  if (options.timezone !== undefined) {
    if (!isTimeZone(options.timezone)) fail(`--timezone "${options.timezone}" is not an IANA time zone, e.g. America/New_York`);
    out.timezone = options.timezone;
  }
  if (options['key-env'] !== undefined) {
    const keyEnv = options['key-env'];
    if (keyEnv === 'none') out.haip_api_key_env = null;
    else if (!KEY_ENV.test(keyEnv)) fail('--key-env must be the NAME of a HAIP_KEY_* variable (e.g. HAIP_KEY_DEMO), or "none"');
    else out.haip_api_key_env = keyEnv;
  }
  if (options.active !== undefined) {
    if (options.active !== 'true' && options.active !== 'false') fail('--active must be true or false');
    out.active = options.active === 'true';
  }
  return out;
}

function databaseUrl() {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    if (process.env.NODE_ENV === 'production' && /\/\/stayx:stayx@/.test(url)) fail('DATABASE_URL uses the development credentials; not allowed when NODE_ENV=production');
    return url;
  }
  if (process.env.NODE_ENV === 'production') fail('DATABASE_URL must be set when NODE_ENV=production');
  return DEV_DATABASE_URL;
}

/** The SQL for add/update, with $n parameters (also what --dry-run prints). */
function statementFor(command, fields, ifMissing = false) {
  if (command === 'add') {
    const columns = ['id', 'name', 'currency_code', 'timezone', 'haip_api_key_env'];
    const values = [fields.id, fields.name, fields.currency_code, fields.timezone, fields.haip_api_key_env ?? null];
    return {
      text: `insert into properties (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})${ifMissing ? ' on conflict (id) do nothing' : ''}`,
      values,
    };
  }
  const { id, ...changes } = fields;
  const columns = Object.keys(changes);
  if (columns.length === 0) fail('update needs at least one field to change');
  return {
    text: `update properties set ${columns.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now() where id = $${columns.length + 1}`,
    values: [...Object.values(changes), id],
  };
}

const { command, options } = parseArgs(process.argv.slice(2));
const CHECK_MENU_CURRENCY =
  'select m.id, m.name, m.currency_code as item_currency, m.property_id, p.name as hotel, p.currency_code as hotel_currency ' +
  'from menu_items m left join properties p on p.id = m.property_id ' +
  'where p.id is null or m.currency_code <> p.currency_code order by p.name nulls first, m.name';

if (!['list', 'add', 'update', 'check-menu-currency'].includes(command)) fail('usage: property.mjs list | add ... | update ... | check-menu-currency (see the top of this file)');
const readOnly = command === 'list' || command === 'check-menu-currency';

const fields = readOnly ? validate(options, []) : validate(options, command === 'add' ? ['id', 'name', 'currency', 'timezone'] : ['id']);
if (readOnly && Object.keys(fields).length > 0) fail(`${command} takes no options except --dry-run`);
if (options.ifMissing && command !== 'add') fail('--if-missing only goes with add');
const statement = readOnly ? null : statementFor(command, fields, options.ifMissing);

if (options.dryRun) {
  const readSql = command === 'check-menu-currency' ? CHECK_MENU_CURRENCY : 'select * from properties order by name';
  console.log(JSON.stringify(statement ?? { text: readSql, values: [] }));
  process.exit(0);
}

// The database driver the API already uses (no extra install).
const postgres = createRequire(new URL('../apps/api/package.json', import.meta.url))('postgres');
const sql = postgres(databaseUrl(), { max: 1, onnotice: () => {} });
try {
  if (command === 'list') {
    const rows = await sql`select id, name, currency_code, timezone, haip_api_key_env, active from properties order by name`;
    if (rows.length === 0) console.log('No properties yet. Add one with: node scripts/property.mjs add --id ... (see the top of this file)');
    for (const r of rows) {
      const key = r.haip_api_key_env ? `${r.haip_api_key_env} (${process.env[r.haip_api_key_env] ? 'set here' : 'NOT set here'})` : 'no HAIP key';
      console.log(`${r.id}  ${r.active ? 'active  ' : 'INACTIVE'}  ${r.currency_code}  ${r.timezone.padEnd(20)}  ${key}  ${r.name}`);
    }
  } else if (command === 'check-menu-currency') {
    const rows = await sql.unsafe(CHECK_MENU_CURRENCY);
    if (rows.length === 0) console.log('Every menu item is in its hotel’s currency.');
    for (const r of rows) {
      const why = r.hotel ? `priced in ${r.item_currency}, ${r.hotel} uses ${r.hotel_currency}` : `hotel ${r.property_id} is not registered`;
      console.log(`${r.id}  ${r.name}: ${why}`);
    }
    if (rows.length > 0) console.log(`${rows.length} item(s) to fix. Orders with them are refused (400) until a manager changes or replaces them.`);
  } else {
    const result = await sql.unsafe(statement.text, statement.values);
    if (command === 'update' && result.count === 0) fail(`no property with id ${fields.id}`);
    if (command === 'add' && result.count === 0) console.log(`${fields.id} is already registered; left as it is.`);
    else console.log(`${command === 'add' ? 'Added' : 'Updated'} ${fields.id}. The API sees the change within 30 seconds.`);
  }
} catch (error) {
  if (error?.code === '23505') fail(`a property with id ${fields.id} already exists (use update)`);
  if (error?.code === '42P01') fail('the properties table does not exist yet: apply migration 0003 first');
  fail(error?.message ?? String(error));
} finally {
  await sql.end({ timeout: 5 });
}
