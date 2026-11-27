// Live run: StayX POS bridge -> real local HAIP. The API key is held in memory only
// (and in the POS API child's env). It is never printed or written to disk, and is
// revoked at the end. Results: AUDIT.md §9.
//
// ⚠ Changes HAIP demo data (posts charges, moves/checks out/checks in guests,
//   adds then deletes a tax rule). Expects the seeded TGH demo hotel as it was
//   before the first run; on an already-used HAIP DB some scenarios will differ.
//
// Prerequisites (all local, nothing here starts them):
//   - HAIP `docker compose up -d api` (auth off, :3000) plus a second container
//     from the same image with AUTH_ENABLED=true on :3001 (see AUDIT.md §9 Setup).
//   - POS containers up, a scratch DB `stayx_pos_live` migrated, `apps/api` built.
//     Never point this at `stayx_pos`: the sweeper would post its pending rows.
//
// Usage: node scripts/live-run.mjs [outDir]   (outDir defaults to the OS temp dir)
//
// Since the no-in-house guard, S6c expects Retry to be refused (409).
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, createWriteStream, mkdtempSync } from 'node:fs';
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
const RES = {
  r007: 'f1000001-0000-4000-a000-000000000007', // room 202
  r010: 'f1000001-0000-4000-a000-000000000010', // room 110
  r011: 'f1000001-0000-4000-a000-000000000011', // confirmed, STK
};

const results = { startedAt: new Date().toISOString(), steps: [] };
const log = (name, data) => {
  results.steps.push({ name, at: new Date().toISOString(), ...data });
  console.log(`\n## ${name}\n${JSON.stringify(data, null, 2)}`);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}
const haipSql = (q) =>
  execFileSync('docker', ['exec', 'haip-postgres', 'psql', '-U', 'haip', '-d', 'haip', '-tA', '-F', ' | ', '-c', q], { encoding: 'utf8' }).trim();
const posSql = (q) =>
  execFileSync('docker', ['exec', 'pos-postgres-1', 'psql', '-U', 'stayx', '-d', 'stayx_pos_live', '-tA', '-c', q], { encoding: 'utf8' }).trim();
const roomId = (n) => haipSql(`select id from rooms where property_id='${PROP}' and number='${n}'`);
const chargesFor = (vendorTxnId) =>
  haipSql(`select c.id, c.type, c.amount, c.tax_rate, c.description, c.folio_id, f.reservation_id, g.first_name||' '||g.last_name as guest
           from folio_inbound_posts p join charges c on (c.id=p.charge_id or c.parent_charge_id=p.charge_id)
           join folios f on f.id=c.folio_id join reservations r on r.id=f.reservation_id join guests g on g.id=r.guest_id
           where p.vendor_txn_id='${vendorTxnId}' order by c.type desc`).split('\n').filter(Boolean);
const inboundRows = (vendorTxnId) => haipSql(`select count(*) from folio_inbound_posts where vendor_txn_id='${vendorTxnId}'`);

let key, credId, posProc, menuItemId;
const ruleIds = [];

async function outboxFor(orderId) {
  const r = await http('GET', `${POS}/outbox?propertyId=${PROP}&view=all`);
  return (r.body || []).find((x) => x.orderId === orderId);
}
async function waitOutbox(orderId, pred, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  let row;
  while (Date.now() < end) {
    row = await outboxFor(orderId);
    if (row && pred(row)) return row;
    await sleep(1000);
  }
  return { timedOut: true, ...row };
}
const brief = (row) => row && ({ status: row.status, attempts: row.attempts, lastError: row.lastError, haipChargeId: row.haipChargeId, vendorTxnId: row.vendorTxnId, timedOut: row.timedOut });

async function order(room) {
  const r = await http('POST', `${POS}/orders`, { propertyId: PROP, roomNumber: room, items: [{ menuItemId, quantity: 1 }], placedBy: 'live-run', unverified: true });
  if (r.status !== 201) throw new Error(`order ${room}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id;
}
async function advance(id, statuses) {
  for (const status of statuses) {
    const r = await http('PATCH', `${POS}/orders/${id}/status?propertyId=${PROP}`, { status });
    if (r.status !== 200) throw new Error(`status ${status}: ${r.status} ${JSON.stringify(r.body)}`);
  }
}
const TO_READY = ['accepted', 'preparing', 'ready'];

async function startPos() {
  const out = createWriteStream(join(OUT, 'pos-api.log'));
  posProc = spawn(process.execPath, ['dist/main.js'], {
    cwd: POS_DIR,
    env: {
      ...process.env,
      // These runs call the API without a token; the login checks are tested in Step G.
      POS_AUTH_ENABLED: 'false',
      PORT: '4100',
      DATABASE_URL: 'postgres://stayx:stayx@localhost:5433/stayx_pos_live',
      REDIS_URL: 'redis://localhost:6380/1',
      HAIP_API_URL: HAIP_AUTH,
      HAIP_BRIDGE_ENABLED: 'true',
      HAIP_KEY_LIVE: key,
    },
  });
  posProc.stdout.pipe(out);
  posProc.stderr.pipe(out);
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    try { if ((await fetch(`${POS}/menu-items?propertyId=${PROP}`)).ok) return; } catch {}
  }
  throw new Error('POS API did not start');
}

async function main() {
  // --- Setup -------------------------------------------------------------
  const noKey = await http('POST', `${HAIP_AUTH}/folio-inbound/charges`, { roomNumber: '202', type: 'food_beverage', amount: '1.00', currencyCode: 'USD', vendorTxnId: 'probe' });
  const authOff = await http('POST', `${HAIP_OPEN}/folio-inbound/charges`, { roomNumber: '202', type: 'food_beverage', amount: '1.00', currencyCode: 'USD', vendorTxnId: 'probe' });
  log('0a. Probe folio-inbound without key / with AUTH_ENABLED=false', { authOnNoKey: noKey, authOffInstance: authOff });

  const cred = await http('POST', `${HAIP_OPEN}/admin/connect/credentials?propertyId=${PROP}`, { name: 'StayX POS live run (temporary)' });
  if (cred.status !== 201 || !cred.body?.key) throw new Error(`credential create failed: ${cred.status}`);
  key = cred.body.key;
  credId = cred.body.id;
  log('0b. Created temporary property-scoped Connect credential', { status: cred.status, credentialId: credId, keyPrefix: key.slice(0, 8) + '…(redacted)' });

  const props = await http('GET', `${HAIP_AUTH}/connect/properties/${PROP}`, null, { 'x-api-key': key });
  log('0c. GET /connect/properties/:id with key', { status: props.status, currencyCode: props.body?.currencyCode, timezone: props.body?.timezone });

  await startPos();
  const mi = await http('POST', `${POS}/menu-items`, { propertyId: PROP, category: 'Mains', name: 'Live-run Club Sandwich', price: '20.00', currencyCode: 'USD' });
  menuItemId = mi.body.id;
  log('0d. POS API up on :4100 against scratch DB; menu item created', { status: mi.status, price: mi.body.price });

  // --- S1 normal charge ---------------------------------------------------
  const o1 = await order('202');
  await advance(o1, [...TO_READY, 'delivered']);
  const s1 = await waitOutbox(o1, (r) => r.status !== 'pending');
  log('S1. Normal charge, room 202 (in-house)', { orderId: o1, outbox: brief(s1), haipCharges: chargesFor(s1.vendorTxnId) });

  // --- S2a duplicate vendorTxnId, direct --------------------------------
  const dupBody = { roomNumber: '202', type: 'food_beverage', amount: '20.00', currencyCode: 'USD', vendorTxnId: s1.vendorTxnId, description: 'duplicate replay' };
  const dup = await http('POST', `${HAIP_AUTH}/folio-inbound/charges`, dupBody, { 'x-api-key': key });
  log('S2a. Replay same vendorTxnId directly to HAIP', { response: dup, inboundRowsForTxn: inboundRows(s1.vendorTxnId), haipCharges: chargesFor(s1.vendorTxnId) });

  // --- S3 vacant room ------------------------------------------------------
  const o3 = await order('108');
  await advance(o3, [...TO_READY, 'delivered']);
  const s3 = await waitOutbox(o3, (r) => r.status !== 'pending');
  log('S3. Vacant room 108', { orderId: o3, outbox: brief(s3), inboundRowsForTxn: inboundRows(s3.vendorTxnId) });

  // --- S4 room whose only stay is checked out -------------------------------
  const o4 = await order('203');
  await advance(o4, [...TO_READY, 'delivered']);
  const s4 = await waitOutbox(o4, (r) => r.status !== 'pending');
  log('S4. Room 203 (last stay checked_out)', { orderId: o4, outbox: brief(s4), inboundRowsForTxn: inboundRows(s4.vendorTxnId) });

  // --- S5 room move between order and delivery ----------------------------
  const o5 = await order('202');
  await advance(o5, TO_READY);
  const mv = await http('PATCH', `${HAIP_OPEN}/reservations/${RES.r007}/move-room?propertyId=${PROP}`, { roomId: roomId('205'), reason: 'live run' });
  await advance(o5, ['delivered']);
  const s5 = await waitOutbox(o5, (r) => r.status !== 'pending');
  log('S5. Order for room 202, guest moved 202→205 before delivery', { orderId: o5, moveRoom: { status: mv.status, message: mv.body?.message }, outbox: brief(s5), inboundRowsForTxn: inboundRows(s5.vendorTxnId) });

  // --- S6 checkout race, then re-let → wrong guest on retry ----------------
  const o6 = await order('110');
  await advance(o6, TO_READY);
  const co = await http('PATCH', `${HAIP_OPEN}/reservations/${RES.r010}/check-out?propertyId=${PROP}`, {});
  await advance(o6, ['delivered']);
  const s6 = await waitOutbox(o6, (r) => r.status !== 'pending');
  log('S6a. Order room 110; guest checked out before delivery', { orderId: o6, checkOut: { status: co.status, resStatus: co.body?.status, message: co.body?.message }, outbox: brief(s6), inboundRowsForTxn: inboundRows(s6.vendorTxnId) });

  const r110 = roomId('110');
  const hk = [];
  hk.push(['before', haipSql(`select status from rooms where id='${r110}'`)]);
  for (const st of ['clean', 'vacant_clean']) {
    const t = await http('PATCH', `${HAIP_OPEN}/rooms/${r110}/status?propertyId=${PROP}`, { status: st });
    hk.push([st, t.status, t.body?.message]);
  }
  const ci = await http('PATCH', `${HAIP_OPEN}/reservations/${RES.r011}/check-in?propertyId=${PROP}`, { roomId: r110, registrationSigned: true, skipDepositAuth: true });
  log('S6b. Room 110 cleaned and re-let to reservation …011', { roomTransitions: hk, checkIn: { status: ci.status, resStatus: ci.body?.status, message: ci.body?.message } });

  const rt = await http('POST', `${POS}/outbox/${s6.id}/retry?propertyId=${PROP}`);
  const s6c = await waitOutbox(o6, (r) => r.status !== 'pending');
  log('S6c. Staff presses Retry on the needs_attention row', {
    retry: { status: rt.status },
    outbox: brief(s6c),
    haipCharges: s6c.vendorTxnId ? chargesFor(s6c.vendorTxnId) : [],
    orderingGuest: haipSql(`select g.first_name||' '||g.last_name from reservations r join guests g on g.id=r.guest_id where r.id='${RES.r010}'`),
  });

  // --- S7 12% food_beverage tax --------------------------------------------
  for (const p of PROFILES) {
    const r = await http('POST', `${HAIP_OPEN}/tax/profiles/${p}/rules?propertyId=${PROP}`, {
      name: 'Live-run F&B tax', code: 'LIVE_FB', type: 'percentage', rate: '12.0000', appliesToChargeTypes: ['food_beverage'], sortOrder: 9, effectiveFrom: '2026-01-01',
    });
    ruleIds.push([p, r.body?.id]);
    if (r.status !== 201) log('S7. rule create failed', { profile: p, response: r });
  }
  const preview = await http('POST', `${HAIP_OPEN}/tax/calculate`, { propertyId: PROP, amount: '20.00', chargeType: 'food_beverage', serviceDate: new Date().toISOString().slice(0, 10) });
  const t12 = `stayx-live-tax12-${Date.now()}`;
  const direct12 = await http('POST', `${HAIP_AUTH}/folio-inbound/charges`, { roomNumber: '210', type: 'food_beverage', amount: '20.00', currencyCode: 'USD', vendorTxnId: t12 }, { 'x-api-key': key });
  log('S7a. 12% food_beverage rule added to both active profiles; direct post room 210', { rulesCreated: ruleIds.length, taxPreview: preview, response: direct12, inboundRowsForTxn: inboundRows(t12) });

  const o7 = await order('210');
  await advance(o7, [...TO_READY, 'delivered']);
  const s7 = await waitOutbox(o7, (r) => r.attempts >= 1);
  log('S7b. POS order room 210 at 12% (first attempt)', { orderId: o7, outbox: brief(s7) });

  for (const [p, id] of ruleIds) await http('PATCH', `${HAIP_OPEN}/tax/profiles/${p}/rules/${id}?propertyId=${PROP}`, { rate: '9.0000' });
  const s7c = await waitOutbox(o7, (r) => r.status !== 'pending', 120_000);
  log('S7c. Rule changed to 9%; POS retry with backoff', { outbox: brief(s7c), haipCharges: s7c.vendorTxnId ? chargesFor(s7c.vendorTxnId) : [] });

  for (const [p, id] of ruleIds) await http('DELETE', `${HAIP_OPEN}/tax/profiles/${p}/rules/${id}?propertyId=${PROP}`);
  log('S7d. Test tax rules deleted', { remaining: haipSql(`select count(*) from tax_rules where code='LIVE_FB'`) });

  // --- S2b duplicate via POS retry (lost-response simulation) -------------
  posSql(`update haip_post_outbox set status='failed', last_error='simulated: final attempt timed out' where id='${s1.id}'`);
  const rt2 = await http('POST', `${POS}/outbox/${s1.id}/retry?propertyId=${PROP}`);
  const s2b = await waitOutbox(o1, (r) => r.status !== 'pending', 330_000);
  log('S2b. S1 row forced to failed, staff Retry → POS re-posts same vendorTxnId', { retry: { status: rt2.status }, outbox: brief(s2b), inboundRowsForTxn: inboundRows(s1.vendorTxnId), haipCharges: chargesFor(s1.vendorTxnId) });
}

try {
  await main();
} catch (e) {
  log('ERROR', { message: e.message });
} finally {
  if (posProc) posProc.kill();
  if (credId) {
    const rv = await http('DELETE', `${HAIP_OPEN}/admin/connect/credentials/${credId}?propertyId=${PROP}`);
    const after = key ? await http('POST', `${HAIP_AUTH}/folio-inbound/charges`, { roomNumber: '202', type: 'food_beverage', amount: '1.00', currencyCode: 'USD', vendorTxnId: 'after-revoke' }, { 'x-api-key': key }) : null;
    await sleep(500);
    const logs = readFileSync(join(OUT, 'pos-api.log'), 'utf8');
    const haipLogs = execFileSync('docker', ['logs', 'haip-api-auth'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    log('Z. Cleanup', { revoke: rv.status, postAfterRevoke: after?.status, keyFoundInPosLog: logs.includes(key), keyFoundInResults: JSON.stringify(results).includes(key) });
    void haipLogs;
  }
  results.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(0);
}
