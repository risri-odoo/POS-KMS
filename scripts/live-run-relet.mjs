// Follow-up to live-run.mjs S6: re-let room 110 to another guest, then Retry the
// parked POS row. Same key handling: memory only, revoked at the end.
// Same prerequisites and ⚠ HAIP data changes as live-run.mjs. Results: AUDIT.md §9 S6b+c.
//
// Usage: node scripts/live-run-relet.mjs <outDir> <vendorTxnId of the S6a row>
//   (the 2026-10-25 run used stayx-rs-9320df30-b01c-4715-b52a-7e7cbbd4f2ac)
//
// Before the no-in-house guard this Retry posted to the NEW guest's folio.
// With the guard, R2 should show retry 409 and the row still needs_attention.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = process.argv[2];
const TXN = process.argv[3];
if (!OUT || !TXN) {
  console.error('Usage: node scripts/live-run-relet.mjs <outDir> <vendorTxnId>');
  process.exit(1);
}
const POS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/api');
const PROP = 'a0000001-0000-4000-a000-000000000001';
const HAIP_OPEN = 'http://localhost:3000/api/v1';
const HAIP_AUTH = 'http://localhost:3001/api/v1';
const POS = 'http://localhost:4100/api/v1';
const R011 = 'f1000001-0000-4000-a000-000000000011';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (name, data) => console.log(`\n## ${name}\n${JSON.stringify(data, null, 2)}`);

async function http(method, url, body, headers = {}) {
  const res = await fetch(url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}
const haipSql = (q) => execFileSync('docker', ['exec', 'haip-postgres', 'psql', '-U', 'haip', '-d', 'haip', '-tA', '-F', ' | ', '-c', q], { encoding: 'utf8' }).trim();
const posSql = (q) => execFileSync('docker', ['exec', 'pos-postgres-1', 'psql', '-U', 'stayx', '-d', 'stayx_pos_live', '-tA', '-F', ' | ', '-c', q], { encoding: 'utf8' }).trim();

let key, credId, posProc;
try {
  const cred = await http('POST', `${HAIP_OPEN}/admin/connect/credentials?propertyId=${PROP}`, { name: 'StayX POS live run re-let (temporary)' });
  key = cred.body.key; credId = cred.body.id;
  show('R0. Temporary credential', { status: cred.status, credentialId: credId });

  posProc = spawn(process.execPath, ['dist/main.js'], {
    cwd: POS_DIR,
    env: { ...process.env, POS_AUTH_ENABLED: 'false', PORT: '4100', DATABASE_URL: 'postgres://stayx:stayx@localhost:5433/stayx_pos_live', REDIS_URL: 'redis://localhost:6380/1', HAIP_API_URL: HAIP_AUTH, HAIP_BRIDGE_ENABLED: 'true', HAIP_KEY_LIVE: key },
  });
  const out = createWriteStream(join(OUT, 'pos-api-relet.log'));
  posProc.stdout.pipe(out); posProc.stderr.pipe(out);
  for (let i = 0; i < 60; i++) { await sleep(1000); try { if ((await fetch(`${POS}/menu-items?propertyId=${PROP}`)).ok) break; } catch {} }

  const r110 = haipSql(`select id from rooms where property_id='${PROP}' and number='110'`);
  const as = await http('PATCH', `${HAIP_OPEN}/reservations/${R011}/assign-room?propertyId=${PROP}`, { roomId: r110 });
  const ci = await http('PATCH', `${HAIP_OPEN}/reservations/${R011}/check-in?propertyId=${PROP}`, { registrationSigned: true, skipDepositAuth: true });
  show('R1. Reservation …011 assigned to room 110 and checked in', { assign: { status: as.status, message: as.body?.message }, checkIn: { status: ci.status, resStatus: ci.body?.status, message: ci.body?.message }, newGuest: haipSql(`select g.first_name||' '||g.last_name from reservations r join guests g on g.id=r.guest_id where r.id='${R011}'`) });

  const [rowId, before] = posSql(`select id, status from haip_post_outbox where vendor_txn_id='${TXN}'`).split(' | ');
  const rt = await http('POST', `${POS}/outbox/${rowId}/retry?propertyId=${PROP}`);
  let row;
  for (let i = 0; i < 60; i++) { await sleep(1000); row = posSql(`select status, attempts, coalesce(last_error,''), coalesce(haip_charge_id,'') from haip_post_outbox where id='${rowId}'`); if (!row.startsWith('pending')) break; }
  const charges = haipSql(`select c.id, c.type, c.amount, f.reservation_id, g.first_name||' '||g.last_name from folio_inbound_posts p join charges c on c.id=p.charge_id join folios f on f.id=c.folio_id join reservations r on r.id=f.reservation_id join guests g on g.id=r.guest_id where p.vendor_txn_id='${TXN}'`);
  show('R2. Staff Retry on the parked row (order was for Maria Garcia, res …010)', { rowStatusBefore: before, retry: rt.status, rowAfter: row, haipCharge: charges });
} catch (e) {
  show('ERROR', { message: e.message });
} finally {
  if (posProc) posProc.kill();
  if (credId) {
    const rv = await http('DELETE', `${HAIP_OPEN}/admin/connect/credentials/${credId}?propertyId=${PROP}`);
    await sleep(500);
    show('RZ. Cleanup', { revoke: rv.status, keyFoundInPosLog: readFileSync(join(OUT, 'pos-api-relet.log'), 'utf8').includes(key) });
  }
  process.exit(0);
}
