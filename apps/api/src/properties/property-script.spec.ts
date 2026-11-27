import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** scripts/property.mjs in --dry-run mode: validation and the SQL it would run, no database. */
const SCRIPT = fileURLToPath(new URL('../../../../scripts/property.mjs', import.meta.url));
const A = 'a0000001-0000-4000-a000-000000000001';

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'development' } });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

describe('scripts/property.mjs (dry run)', () => {
  it('add: inserts the normalised fields, with the key variable NAME only', () => {
    const r = run('add', '--id', A.toUpperCase(), '--name', ' Demo hotel ', '--currency', 'usd', '--timezone', 'America/New_York', '--key-env', 'HAIP_KEY_DEMO', '--dry-run');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({
      text: 'insert into properties (id, name, currency_code, timezone, haip_api_key_env) values ($1, $2, $3, $4, $5)',
      values: [A, 'Demo hotel', 'USD', 'America/New_York', 'HAIP_KEY_DEMO'],
    });
  });

  it('add --if-missing: leaves an existing hotel alone (pnpm run setup)', () => {
    const r = run('add', '--id', A, '--name', 'Demo hotel', '--currency', 'USD', '--timezone', 'UTC', '--if-missing', '--dry-run');
    expect(JSON.parse(r.out).text).toMatch(/ on conflict \(id\) do nothing$/);
    expect(run('update', '--id', A, '--name', 'X', '--if-missing', '--dry-run').err).toContain('--if-missing only goes with add');
  });

  it('check-menu-currency: a read-only query for items not in their hotel’s currency or hotel', () => {
    const r = run('check-menu-currency', '--dry-run');
    expect(r.code).toBe(0);
    const { text, values } = JSON.parse(r.out) as { text: string; values: unknown[] };
    expect(text).toMatch(/^select /);
    expect(text).toContain('left join properties p on p.id = m.property_id');
    expect(text).toContain('p.id is null or m.currency_code <> p.currency_code');
    expect(values).toEqual([]);
    expect(run('check-menu-currency', '--id', A, '--dry-run').err).toContain('takes no options');
  });

  it('update: only the given fields; "none" removes the key variable', () => {
    const r = run('update', '--id', A, '--key-env', 'none', '--active', 'false', '--dry-run');
    expect(JSON.parse(r.out)).toEqual({
      text: 'update properties set haip_api_key_env = $1, active = $2, updated_at = now() where id = $3',
      values: [null, false, A],
    });
  });

  it.each([
    [['add', '--id', 'not-a-uuid', '--name', 'X', '--currency', 'USD', '--timezone', 'UTC'], '--id must be the HAIP property UUID'],
    [['add', '--id', A, '--name', 'X', '--currency', 'US', '--timezone', 'UTC'], 'three-letter ISO 4217'],
    [['add', '--id', A, '--name', 'X', '--currency', 'USD', '--timezone', 'Mars/Base'], 'not an IANA time zone'],
    [['add', '--id', A, '--name', 'X', '--currency', 'USD', '--timezone', 'UTC', '--key-env', 'DATABASE_URL'], 'NAME of a HAIP_KEY_* variable'],
    [['add', '--id', A, '--name', 'X', '--currency', 'USD'], '--timezone is required'],
    [['update', '--id', A], 'at least one field'],
    [['add', '--id', A, '--name', 'X', '--currency', 'USD', '--timezone', 'UTC', '--key', 'HAIP_KEY_X'], 'unknown option --key'],
    [['remove', '--id', A], 'usage'],
  ])('refuses %j', (args, message) => {
    const r = run(...args, '--dry-run');
    expect(r.code).toBe(2);
    expect(r.err).toContain(message);
  });
});
