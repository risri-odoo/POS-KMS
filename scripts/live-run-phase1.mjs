// Phase 1 live posting run (INTEGRATION_DESIGN.md §4.8, AUDIT.md §16): POS orders bound to
// HAIP stays, posted through folio-inbound with the worker's stay re-check.
//
// ⚠ Changes HAIP's demo data: posts four 20.00 food_beverage charges, moves reservation …000b
//   210 → 208, checks out …000e and …0009, cleans rooms, assigns and checks in …0014 to 302,
//   and stops/starts haip-keycloak. Back up the haip database first (AUDIT.md §16 has the reset).
//
// Prerequisites (AUDIT.md §15–16):
//   - HAIP :3000 (auth off) and haip-api-auth :3001 (auth on), haip-keycloak, haip-postgres
//   - pos-postgres-1 with stayx_pos_live migrated to 0001; pos-redis-1 (Redis DB 1)
//   - the POS API built (apps/api/dist); "Live-run Club Sandwich" in stayx_pos_live
//   - ../secrets/stayx-pos-sp.env (service principal for HAIP_STAY_LOOKUP=haip)
//
// The temporary folio-inbound key and the client secret are held in memory only: never
// printed or written. The key is revoked at the end. Stops at the first unexpected result.
//
// Usage: node scripts/live-run-phase1.mjs [outDir]   (outDir defaults to a new temp dir)
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, createWriteStream, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'stayx-phase1-'));
const POS_DIR = resolve(HERE, '../apps/api');
const SECRETS = resolve(HERE, '../../secrets/stayx-pos-sp.env');
const PROP = 'a0000001-0000-4000-a000-000000000001';
const HAIP_OPEN = 'http://localhost:3000/api/v1';
const HAIP_AUTH = 'http://localhost:3001/api/v1';
const POS = 'http://localhost:4100/api/v1';
const res = (suffix) => `f1000001-0000-4000-a000-000000000${suffix}`;
const R = { david: res('008'), hans: res('00b'), lisa: res('00e'), ahmed: res('009'), marcus: res('006'), takeshi: res('00a'), elena: res('014') };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
class Surprise extends Error {}

/** Record a check; stop the run on the first one that fails. */
function expect(scenario, label, ok, detail = {}) {
  results.push({ scenario, label, ok, ...detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${scenario}: ${label}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!ok) throw new Surprise(`${scenario}: ${label}`);
}

async function http(method, url, body, headers = {}) {
  const r = await fetch(url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, body: json };
}
const sql = (container, user, db) => (q) => execFileSync('docker', ['exec', container, 'psql', '-U', user, '-d', db, '-tA', '-F', ' | ', '-c', q], { encoding: 'utf8' }).trim();
const haipSql = sql('haip-postgres', 'haip', 'haip');
const posSql = sql('pos-postgres-1', 'stayx', 'stayx_pos_live');
const roomId = (n) => haipSql(`select id from rooms where property_id='${PROP}' and number='${n}'`);
const roomStatus = (n) => haipSql(`select status from rooms where property_id='${PROP}' and number='${n}'`);
const guestFolio = (resId) => haipSql(`select id from folios where reservation_id='${resId}' and type='guest' order by created_at desc limit 1`);
/** What HAIP recorded for a vendorTxnId: the folio-inbound row and the charge's folio and reservation. */
const haipPost = (txn) => {
  const row = haipSql(`select p.room_number, c.folio_id, f.reservation_id, c.amount, c.type from folio_inbound_posts p join charges c on c.id=p.charge_id join folios f on f.id=c.folio_id where p.vendor_txn_id='${txn}'`);
  if (!row) return null;
  const [room, folioId, reservationId, amount, type] = row.split(' | ');
  return { room, folioId, reservationId, amount, type };
};
const postCount = (txn) => Number(haipSql(`select count(*) from folio_inbound_posts where vendor_txn_id='${txn}'`));
const fbChargesOn = (folioId) => Number(haipSql(`select count(*) from charges where folio_id='${folioId}' and type='food_beverage'`));

// ---- Secrets and the POS API process --------------------------------------------------------
const spEnv = Object.fromEntries(
  readFileSync(SECRETS, 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
let key, credId, pos, posLogs = [], keycloakStopped = false;

async function startPos(label) {
  const logFile = join(OUT, `pos-api-${label}.log`);
  posLogs.push(logFile);
  pos = spawn(process.execPath, ['dist/main.js'], {
    cwd: POS_DIR,
    env: {
      ...process.env, ...spEnv, PORT: '4100',
      // These runs call the API without a token; the login checks are tested in Step G.
      POS_AUTH_ENABLED: 'false',
      DATABASE_URL: 'postgres://stayx:stayx@localhost:5433/stayx_pos_live', REDIS_URL: 'redis://localhost:6380/1',
      HAIP_API_URL: HAIP_AUTH, HAIP_BRIDGE_ENABLED: 'true', HAIP_KEY_LIVE: key,
    },
  });
  const out = createWriteStream(logFile);
  pos.stdout.pipe(out); pos.stderr.pipe(out);
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    try { if ((await fetch(`${POS}/menu-items?propertyId=${PROP}`)).ok) return; } catch {}
  }
  throw new Surprise(`POS API (${label}) did not start`);
}
async function stopPos() {
  if (!pos) return;
  pos.kill();
  for (let i = 0; i < 20; i++) { await sleep(500); try { await fetch(`${POS}/menu-items?propertyId=${PROP}`); } catch { break; } }
  pos = undefined;
}
const posLogText = () => posLogs.map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');

// ---- POS helpers -----------------------------------------------------------------------------
let menuItemId;
async function placeBound(scenario, room, displayName) {
  const lk = await http('GET', `${POS}/stays/lookup?propertyId=${PROP}&roomNumber=${room}`);
  const stay = lk.body?.stays?.find((s) => s.guests.some((g) => g.displayName === displayName));
  expect(scenario, `lookup room ${room} shows ${displayName}`, lk.status === 200 && lk.body?.status === 'found' && Boolean(stay), { lookup: lk.body?.status });
  const o = await http('POST', `${POS}/orders`, {
    propertyId: PROP, roomNumber: room, items: [{ menuItemId, quantity: 1 }], placedBy: 'live-run-phase1',
    reservationId: stay.reservationId, confirmedGuestName: displayName,
  });
  expect(scenario, 'order placed and verified', o.status === 201 && o.body?.verificationStatus === 'verified' && o.body?.haipReservationId === stay.reservationId, { status: o.status, verification: o.body?.verificationStatus });
  return o.body;
}
async function placeUnverified(scenario, room) {
  const o = await http('POST', `${POS}/orders`, { propertyId: PROP, roomNumber: room, items: [{ menuItemId, quantity: 1 }], placedBy: 'live-run-phase1', unverified: true });
  expect(scenario, `unverified order accepted for room ${room} while the lookup is down`, o.status === 201 && o.body?.verificationStatus === 'unverified' && o.body?.haipReservationId === null, { status: o.status, message: o.body?.message });
  return o.body;
}
async function deliver(order) {
  for (const status of ['accepted', 'preparing', 'ready', 'delivered']) {
    const r = await http('PATCH', `${POS}/orders/${order.id}/status?propertyId=${PROP}`, { status });
    if (r.status !== 200) throw new Surprise(`order ${order.orderNumber} → ${status}: HTTP ${r.status}`);
  }
}
const outboxRow = (orderId) => {
  const row = posSql(`select id, status, attempts, coalesce(parked_reason::text,''), coalesce(haip_reservation_id::text,''), coalesce(last_error,''), coalesce(next_retry_at > now() + interval '4 minutes', false) from haip_post_outbox where order_id='${orderId}'`);
  if (!row) return null;
  const [id, status, attempts, parkedReason, reservationId, lastError, retryLater] = row.split(' | ');
  return { id, status, attempts: Number(attempts), parkedReason, reservationId, lastError, retryLater: retryLater === 't' };
};
async function waitOutbox(orderId, until, ms = 60_000) {
  let row;
  for (let t = 0; t < ms; t += 1000) { await sleep(1000); row = outboxRow(orderId); if (row && until(row)) return row; }
  return row;
}
const vendorTxn = (orderId) => `stayx-rs-${orderId}`;

// ---- Run --------------------------------------------------------------------------------------
try {
  console.log(`outDir: ${OUT}`);
  const cred = await http('POST', `${HAIP_OPEN}/admin/connect/credentials?propertyId=${PROP}`, { name: 'StayX POS phase 1 live run (temporary)' });
  key = cred.body?.key; credId = cred.body?.id;
  expect('setup', 'temporary property key created', cred.status === 201 && typeof key === 'string', { status: cred.status, credentialId: credId });

  await startPos('A');
  const menu = await http('GET', `${POS}/menu-items?propertyId=${PROP}`);
  menuItemId = menu.body?.find((m) => m.name === 'Live-run Club Sandwich')?.id;
  expect('setup', 'POS API up, HAIP lookup on, menu item found', Boolean(menuItemId) && posLogText().includes('Stay lookup uses HAIP staff REST'));

  // Phase A: lookup up. Place every bound order first.
  const s1 = await placeBound('S1', '101', 'David P.');
  const s2 = await placeBound('S2', '210', 'Hans M.');
  const s3 = await placeBound('S3', '405', 'Lisa T.');
  const s4 = await placeBound('S4', '302', 'Ahmed A.');
  const s5 = await placeBound('S5', '201', 'Marcus W.');

  // S1: normal post.
  await deliver(s1);
  let row = await waitOutbox(s1.id, (r) => r.status !== 'pending');
  let post = haipPost(vendorTxn(s1.id));
  expect('S1', 'posted to David P.’s folio by room 101', row?.status === 'posted' && post?.reservationId === R.david && post?.room === '101' && post?.amount === '20.00', { outbox: row?.status, haip: post });

  // S2: room move before delivery.
  const mv = await http('PATCH', `${HAIP_OPEN}/reservations/${R.hans}/move-room?propertyId=${PROP}`, { roomId: roomId('208'), reason: 'phase 1 live run' });
  expect('S2', 'HAIP moved Hans M. 210 → 208', mv.status === 200, { status: mv.status, message: mv.body?.message });
  await deliver(s2);
  row = await waitOutbox(s2.id, (r) => r.status !== 'pending');
  post = haipPost(vendorTxn(s2.id));
  expect('S2', 'posted by the NEW room 208 to Hans M.’s folio', row?.status === 'posted' && post?.room === '208' && post?.reservationId === R.hans, { outbox: row?.status, haip: post });

  // S3: checkout before delivery.
  const co3 = await http('PATCH', `${HAIP_OPEN}/reservations/${R.lisa}/check-out?propertyId=${PROP}`, {});
  expect('S3', 'HAIP checked out Lisa T.', co3.status === 200, { status: co3.status, message: co3.body?.message });
  await deliver(s3);
  row = await waitOutbox(s3.id, (r) => r.status !== 'pending');
  expect('S3', 'parked as stay_ended, nothing sent', row?.status === 'needs_attention' && row?.parkedReason === 'stay_ended' && row?.attempts === 0 && postCount(vendorTxn(s3.id)) === 0, { outbox: row });

  // S4: checkout, re-let, Retry.
  const co4 = await http('PATCH', `${HAIP_OPEN}/reservations/${R.ahmed}/check-out?propertyId=${PROP}`, {});
  expect('S4', 'HAIP checked out Ahmed A.', co4.status === 200, { status: co4.status, message: co4.body?.message });
  await deliver(s4);
  row = await waitOutbox(s4.id, (r) => r.status !== 'pending');
  expect('S4', 'parked as stay_ended, nothing sent', row?.status === 'needs_attention' && row?.parkedReason === 'stay_ended' && postCount(vendorTxn(s4.id)) === 0, { outbox: row });
  const before302 = roomStatus('302');
  for (const status of ['clean', 'vacant_clean']) {
    const t = await http('PATCH', `${HAIP_OPEN}/rooms/${roomId('302')}/status?propertyId=${PROP}`, { status });
    expect('S4', `room 302 → ${status}`, t.status === 200, { status: t.status, from: before302, message: t.body?.message });
  }
  const as = await http('PATCH', `${HAIP_OPEN}/reservations/${R.elena}/assign-room?propertyId=${PROP}`, { roomId: roomId('302') });
  expect('S4', 'reservation …0014 (Elena P.) assigned to 302', as.status === 200, { status: as.status, message: as.body?.message });
  const ci = await http('PATCH', `${HAIP_OPEN}/reservations/${R.elena}/check-in?propertyId=${PROP}`, { registrationSigned: true, skipDepositAuth: true });
  expect('S4', 'Elena P. checked in to 302 (room re-let)', ci.status === 200, { status: ci.status, message: ci.body?.message });
  const elenaFolio = guestFolio(R.elena);
  const retry = await http('POST', `${POS}/outbox/${row.id}/retry?propertyId=${PROP}`);
  await sleep(3000);
  const after = outboxRow(s4.id);
  expect('S4', 'Retry refused with 409, row unchanged, no charge for Elena P. or anyone', retry.status === 409 && after?.status === 'needs_attention' && after?.parkedReason === 'stay_ended' && postCount(vendorTxn(s4.id)) === 0 && fbChargesOn(elenaFolio) === 0, { retry: retry.status, message: retry.body?.message, row: after?.status });

  // Phase B: lookup down. Stop Keycloak, restart the POS API so no token is cached.
  execFileSync('docker', ['stop', 'haip-keycloak']); keycloakStopped = true;
  await stopPos();
  await startPos('B');
  await deliver(s5);
  row = await waitOutbox(s5.id, (r) => r.retryLater || r.status !== 'pending', 30_000);
  expect('S5', 'deferred: still pending, no attempt used, retry in ~5 min, nothing sent', row?.status === 'pending' && row?.attempts === 0 && row?.retryLater && row?.lastError.includes('nothing sent yet') && postCount(vendorTxn(s5.id)) === 0, { outbox: row });
  const s6 = await placeUnverified('S6', '102');
  const s6b = await placeUnverified('S6b', '103');

  // Phase C: lookup back.
  execFileSync('docker', ['start', 'haip-keycloak']);
  for (let i = 0; i < 90; i++) { await sleep(2000); try { if ((await fetch('http://localhost:8080/realms/haip/.well-known/openid-configuration')).ok) break; } catch {} }
  keycloakStopped = false;
  expect('setup', 'Keycloak back', (await fetch('http://localhost:8080/realms/haip/.well-known/openid-configuration')).ok);

  await deliver(s6);
  row = await waitOutbox(s6.id, (r) => r.status !== 'pending');
  post = haipPost(vendorTxn(s6.id));
  const s6Order = posSql(`select verification_status, coalesce(haip_reservation_id::text,'') from orders where id='${s6.id}'`).split(' | ');
  expect('S6', 'matched at posting: posted to Takeshi Y.’s folio, ids stored, still unverified, logged', row?.status === 'posted' && post?.reservationId === R.takeshi && row?.reservationId === R.takeshi && s6Order[0] === 'unverified' && s6Order[1] === R.takeshi && /matched at posting/.test(posLogText()), { outbox: row?.status, order: s6Order, haip: post });

  await deliver(s6b);
  row = await waitOutbox(s6b.id, (r) => r.status !== 'pending');
  expect('S6b', 'unverified order for empty room 103: needs_verification, nothing sent', row?.status === 'needs_attention' && row?.parkedReason === 'needs_verification' && postCount(vendorTxn(s6b.id)) === 0, { outbox: row });

  // S5r: the sweeper retries the deferred row after the 5-minute delay.
  console.log('S5r: waiting up to 8 minutes for the sweeper…');
  row = await waitOutbox(s5.id, (r) => r.status !== 'pending', 8 * 60_000);
  post = haipPost(vendorTxn(s5.id));
  expect('S5r', 'after recovery the deferred order posted to Marcus W.’s folio', row?.status === 'posted' && post?.reservationId === R.marcus && post?.room === '201', { outbox: row?.status, haip: post });

  // The S4 row stayed parked through all of that (sweeper never picks it up).
  const s4End = outboxRow(s4.id);
  expect('S4', 'still parked after ≥5 minutes of sweeps, still nothing sent', s4End?.status === 'needs_attention' && postCount(vendorTxn(s4.id)) === 0 && fbChargesOn(elenaFolio) === 0, { outbox: s4End?.status });
} catch (error) {
  console.log(`\nSTOPPED: ${error instanceof Surprise ? error.message : error?.message ?? error}`);
} finally {
  await stopPos();
  if (keycloakStopped) { execFileSync('docker', ['start', 'haip-keycloak']); console.log('Keycloak restarted during clean-up'); }
  if (credId) {
    const rv = await http('DELETE', `${HAIP_OPEN}/admin/connect/credentials/${credId}?propertyId=${PROP}`);
    await sleep(500);
    const afterRevoke = await http('POST', `${HAIP_AUTH}/folio-inbound/charges`, { roomNumber: '101', type: 'food_beverage', amount: '1.00', currencyCode: 'USD', vendorTxnId: 'after-revoke-phase1' }, { 'x-api-key': key });
    const logs = posLogText();
    console.log(JSON.stringify({ cleanup: { revoke: rv.status, postAfterRevoke: afterRevoke.status, keyInPosLog: logs.includes(key), secretInPosLog: logs.includes(spEnv.HAIP_SP_CLIENT_SECRET) } }));
  }
  console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }));
  process.exit(0);
}
