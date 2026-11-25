// S7 only from scripts/live-run.mjs (12% food_beverage tax), re-run against HAIP def7c03.
// Same key handling: memory only, revoked at the end. Results: AUDIT.md §10 Re-test.
//
// ⚠ Posts real charges to the HAIP demo folio for room 210 (2 x 22.40) and adds,
//   then deletes, a 12% tax rule.
//
// Same prerequisites as live-run.mjs, plus: run live-run.mjs first, because this
// reuses its "Live-run Club Sandwich" menu item in stayx_pos_live.
//
// Usage: node scripts/live-run-tax12.mjs [outDir]   (outDir defaults to the OS temp dir)
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, createWriteStream, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'stayx-live-run-'));
const POS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/api');
const PROP = 'a0000001-0000-4000-a000-000000000001';
const HAIP_OPEN = 'http://localhost:3000/api/v1';
const HAIP_AUTH = 'http://localhost:3001/api/v1';
const POS = 'http://localhost:4100/api/v1';
const PROFILES = ['a5000001-0000-4000-a000-000000000001', 'a5000001-0000-4000-a000-000000000002'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (name, data) => console.log(`\n## ${name}\n${JSON.stringify(data, null, 2)}`);

async function http(method, url, body, headers = {}) {
  const res = await fetch(url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}
const haipSql = (q) => execFileSync('docker', ['exec', 'haip-postgres', 'psql', '-U', 'haip', '-d', 'haip', '-tA', '-F', ' | ', '-c', q], { encoding: 'utf8' }).trim();
const chargesFor = (vendorTxnId) =>
  haipSql(`select c.id, c.type, c.amount, c.tax_rate, c.description, c.folio_id, g.first_name||' '||g.last_name
           from folio_inbound_posts p join charges c on (c.id=p.charge_id or c.parent_charge_id=p.charge_id)
           join folios f on f.id=c.folio_id join reservations r on r.id=f.reservation_id join guests g on g.id=r.guest_id
           where p.vendor_txn_id='${vendorTxnId}' order by c.type desc`).split('\n').filter(Boolean);
const balance = () => haipSql(`select balance from folios where id='f2000001-0000-4000-a000-00000000000b'`);

let key, credId, posProc;
const ruleIds = [];
try {
  const health = await http('GET', `${HAIP_AUTH}/health`);
  const cred = await http('POST', `${HAIP_OPEN}/admin/connect/credentials?propertyId=${PROP}`, { name: 'StayX POS tax re-run (temporary)' });
  key = cred.body.key; credId = cred.body.id;
  show('T0. Setup', { authInstanceHealth: health.status, credential: cred.status, credentialId: credId, folioBalanceBefore: balance() });

  posProc = spawn(process.execPath, ['dist/main.js'], {
    cwd: POS_DIR,
    env: { ...process.env, POS_AUTH_ENABLED: 'false', PORT: '4100', DATABASE_URL: 'postgres://stayx:stayx@localhost:5433/stayx_pos_live', REDIS_URL: 'redis://localhost:6380/1', HAIP_API_URL: HAIP_AUTH, HAIP_API_KEY: key, HAIP_PROPERTY_ID: PROP, HAIP_TIMEZONE: 'America/New_York' },
  });
  const out = createWriteStream(join(OUT, 'pos-api-tax12.log'));
  posProc.stdout.pipe(out); posProc.stderr.pipe(out);
  for (let i = 0; i < 60; i++) { await sleep(1000); try { if ((await fetch(`${POS}/menu-items?propertyId=${PROP}`)).ok) break; } catch {} }
  const menu = await http('GET', `${POS}/menu-items?propertyId=${PROP}`);
  const menuItemId = menu.body.find((m) => m.name === 'Live-run Club Sandwich').id;

  for (const p of PROFILES) {
    const r = await http('POST', `${HAIP_OPEN}/tax/profiles/${p}/rules?propertyId=${PROP}`, {
      name: 'Live-run F&B tax', code: 'LIVE_FB', type: 'percentage', rate: '12.0000', appliesToChargeTypes: ['food_beverage'], sortOrder: 9, effectiveFrom: '2026-01-01',
    });
    ruleIds.push([p, r.body?.id, r.status]);
  }
  const t12 = `stayx-live-tax12-${Date.now()}`;
  const direct = await http('POST', `${HAIP_AUTH}/folio-inbound/charges`, { roomNumber: '210', type: 'food_beverage', amount: '20.00', currencyCode: 'USD', vendorTxnId: t12 }, { 'x-api-key': key });
  show('T1. 12% rule on both active profiles; direct post room 210', {
    rules: ruleIds.map(([, , s]) => s),
    response: { status: direct.status, id: direct.body?.id, amount: direct.body?.amount, taxCharges: direct.body?.taxCharges?.map((t) => ({ amount: t.amount, taxRate: t.taxRate, description: t.description })) },
    haipCharges: chargesFor(t12),
  });

  const o = await http('POST', `${POS}/orders`, { propertyId: PROP, roomNumber: '210', items: [{ menuItemId, quantity: 1 }], placedBy: 'live-run-tax12', unverified: true });
  for (const status of ['accepted', 'preparing', 'ready', 'delivered']) await http('PATCH', `${POS}/orders/${o.body.id}/status?propertyId=${PROP}`, { status });
  let row;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    row = (await http('GET', `${POS}/outbox?propertyId=${PROP}`)).body.find((x) => x.orderId === o.body.id);
    if (row && row.status !== 'pending') break;
  }
  show('T2. POS order room 210 at 12%', {
    orderId: o.body.id,
    outbox: { status: row?.status, attempts: row?.attempts, lastError: row?.lastError, haipChargeId: row?.haipChargeId, vendorTxnId: row?.vendorTxnId },
    haipCharges: row?.vendorTxnId ? chargesFor(row.vendorTxnId) : [],
    folioBalanceAfter: balance(),
  });
} catch (e) {
  show('ERROR', { message: e.message });
} finally {
  if (posProc) posProc.kill();
  for (const [p, id] of ruleIds) if (id) await http('DELETE', `${HAIP_OPEN}/tax/profiles/${p}/rules/${id}?propertyId=${PROP}`);
  if (credId) {
    const rv = await http('DELETE', `${HAIP_OPEN}/admin/connect/credentials/${credId}?propertyId=${PROP}`);
    const after = await http('POST', `${HAIP_AUTH}/folio-inbound/charges`, { roomNumber: '210', type: 'food_beverage', amount: '1.00', currencyCode: 'USD', vendorTxnId: 'after-revoke-tax12' }, { 'x-api-key': key });
    await sleep(500);
    show('TZ. Cleanup', { rulesRemaining: haipSql(`select count(*) from tax_rules where code='LIVE_FB'`), revoke: rv.status, postAfterRevoke: after.status, keyFoundInPosLog: readFileSync(join(OUT, 'pos-api-tax12.log'), 'utf8').includes(key) });
  }
  process.exit(0);
}
