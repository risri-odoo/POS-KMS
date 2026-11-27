import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { drizzle } from 'drizzle-orm/pg-proxy';
import * as schema from '@stayx/database';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import { DRIZZLE } from '../database/database.module.js';
import { OrderEventsService } from '../events/order-events.service.js';
import { HaipQueue } from '../haip/haip-queue.service.js';
import { NotConfiguredStayLookup, STAY_LOOKUP } from '../haip/stay-lookup.js';
import { MenuController } from '../menu/menu.controller.js';
import { MenuService } from '../menu/menu.service.js';
import { OrdersController } from '../orders/orders.controller.js';
import { OrdersService } from '../orders/orders.service.js';
import { OutboxController } from '../outbox/outbox.controller.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { PROPERTY_DIRECTORY } from '../properties/properties.service.js';
import { OutboxAlerts } from '../events/outbox-alerts.service.js';
import { AUTH_CONFIG, loadAuthConfig } from './auth.config.js';
import { AuthModule } from './auth.module.js';
import { TOKEN_VERIFIER, TokenVerifier } from './token-verifier.js';

/**
 * Routes that take a record :id must not act on (or reveal) another hotel's record.
 * The guard checks the request's propertyId against the token; the services must then
 * scope the record by that propertyId in SQL. These run the REAL services and their
 * SQL against an in-memory fake, so dropping the property condition from a query fails here.
 */
const ISSUER = 'http://localhost:8080/realms/haip';
const A = 'a0000001-0000-4000-a000-00000000000a';
const B = 'b0000002-0000-4000-a000-00000000000b';
const ORDER_A = '0a000000-0000-4000-8000-00000000000a';
const ORDER_B = '0b000000-0000-4000-8000-00000000000b';
const OUTBOX_A = '1a000000-0000-4000-8000-00000000000a';
const OUTBOX_B = '1b000000-0000-4000-8000-00000000000b';
const MENU_B = '2b000000-0000-4000-8000-00000000000b';
const MISSING = '3c000000-0000-4000-8000-00000000000c';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;

function seed() {
  tables = {
    orders: [
      { id: ORDER_A, property_id: A, status: 'placed', room_number: '101' },
      { id: ORDER_B, property_id: B, status: 'placed', room_number: '201' },
    ],
    order_items: [],
    haip_post_outbox: [
      { id: OUTBOX_A, property_id: A, status: 'needs_attention', parked_reason: null },
      { id: OUTBOX_B, property_id: B, status: 'needs_attention', parked_reason: null },
    ],
    menu_items: [{ id: MENU_B, property_id: B, name: 'Tea' }],
  };
}

/** Columns named in a select list or a returning list, in order. */
const columnsOf = (list: string) => list.split(',').map((item) => [...item.matchAll(/"(\w+)"/g)].at(-1)![1]!);

/**
 * Just enough SQL for these routes: the WHERE is read as AND-ed `"col" = $n` and
 * `"col" in ($n, …)`; OR groups (the retry guard) are skipped. A row matches only
 * on the conditions actually in the SQL, so a missing property_id condition shows.
 */
function fakeQuery(sql: string, params: unknown[]): { rows: unknown[][] } {
  const table = /(?:from|update) "(\w+)"/.exec(sql)![1]!;
  const where = (/ where (.*?)(?: order by | returning |$)/.exec(sql)?.[1] ?? '').replace(/\([^()]* or [^()]*\)/g, '');
  const conditions = [
    ...[...where.matchAll(/"(\w+)" = \$(\d+)/g)].map(([, col, n]) => ({ col: col!, values: [params[Number(n) - 1]] })),
    ...[...where.matchAll(/"(\w+)" in \(([^)]*)\)/g)].map(([, col, list]) => ({
      col: col!,
      values: [...list!.matchAll(/\$(\d+)/g)].map(([, n]) => params[Number(n) - 1]),
    })),
  ];
  const matched = (tables[table] ?? []).filter((row) => conditions.every(({ col, values }) => values.includes(row[col] ?? null)));
  const list = sql.startsWith('select') ? /^select (.*?) from /.exec(sql)![1]! : (/ returning (.*)$/.exec(sql)?.[1] ?? '');
  const columns = columnsOf(list);
  return { rows: matched.map((row) => columns.map((col) => row[col] ?? null)) };
}

const proxyDb = drizzle(async (sql, params) => fakeQuery(sql, params), { schema });
// pg-proxy has no transactions; run the callback on the same handle.
const fakeDb = Object.assign(proxyDb, { transaction: (run: (tx: unknown) => unknown) => run(proxyDb) });

let app: INestApplication<App>;
let key: CryptoKey;
const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
const events = { emitOrderCreated: vi.fn(), emitOrderStatusChanged: vi.fn() };

function token(roles: string[], propertyIds: string[], azp = 'stayx-pos-web') {
  return new SignJWT({ azp, preferred_username: 'u', resource_access: { 'stayx-pos-api': { roles } }, property_ids: propertyIds })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setAudience('stayx-pos-api')
    .setSubject('u')
    .setExpirationTime('5m')
    .sign(key);
}

beforeAll(async () => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
  const config = loadAuthConfig({ POS_OIDC_ISSUER: ISSUER });

  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule],
    controllers: [OrdersController, OutboxController, MenuController],
    providers: [
      OrdersService,
      OutboxService,
      MenuService,
      { provide: DRIZZLE, useValue: fakeDb },
      { provide: OrderEventsService, useValue: events },
      { provide: HaipQueue, useValue: queue },
      { provide: STAY_LOOKUP, useValue: new NotConfiguredStayLookup() },
      { provide: OutboxAlerts, useValue: { refresh: () => Promise.resolve(), stuckCutoff: () => null } },
      // Both test hotels are registered, in USD, with no HAIP key.
      { provide: PROPERTY_DIRECTORY, useValue: { find: (id: string) => Promise.resolve({ id, name: 'Test hotel', currencyCode: 'USD', timezone: 'UTC', haipApiKeyEnv: null, active: true }) } },
    ],
  })
    .overrideProvider(AUTH_CONFIG)
    .useValue(config)
    .overrideProvider(TOKEN_VERIFIER)
    .useValue(new TokenVerifier(config, jwks))
    .compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
});

beforeEach(() => {
  seed();
  queue.enqueue.mockClear();
});

afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('records from another hotel (routes with :id)', () => {
  it('a kitchen tablet for A can change A’s order (control: the fake finds rows)', async () => {
    const t = await token(['pos_kitchen'], [A], 'stayx-kms-web');
    await http().patch(`/orders/${ORDER_A}/status?propertyId=${A}`).set(auth(t)).send({ status: 'accepted' }).expect(200);
  });

  it('a kitchen tablet for A cannot change B’s order: 404, same as an id that doesn’t exist', async () => {
    const t = await token(['pos_kitchen'], [A], 'stayx-kms-web');
    const other = await http().patch(`/orders/${ORDER_B}/status?propertyId=${A}`).set(auth(t)).send({ status: 'accepted' }).expect(404);
    const missing = await http().patch(`/orders/${MISSING}/status?propertyId=${A}`).set(auth(t)).send({ status: 'accepted' }).expect(404);
    expect(other.body.message.replace(ORDER_B, 'ID')).toBe(missing.body.message.replace(MISSING, 'ID'));
    expect(events.emitOrderStatusChanged).not.toHaveBeenCalledWith(expect.objectContaining({ id: ORDER_B }));
  });

  it('naming B as the property instead is refused before any record is looked up (403 for any id)', async () => {
    const t = await token(['pos_kitchen'], [A], 'stayx-kms-web');
    const existing = await http().patch(`/orders/${ORDER_B}/status?propertyId=${B}`).set(auth(t)).send({ status: 'accepted' }).expect(403);
    const missing = await http().patch(`/orders/${MISSING}/status?propertyId=${B}`).set(auth(t)).send({ status: 'accepted' }).expect(403);
    expect(existing.body).toEqual(missing.body);
  });

  it('staff for A cannot read B’s order: 404', async () => {
    const t = await token(['pos_staff'], [A]);
    await http().get(`/orders/${ORDER_A}?propertyId=${A}`).set(auth(t)).expect(200);
    await http().get(`/orders/${ORDER_B}?propertyId=${A}`).set(auth(t)).expect(404);
  });

  it('a manager for A can retry A’s outbox row (control)', async () => {
    const t = await token(['pos_manager'], [A]);
    await http().post(`/outbox/${OUTBOX_A}/retry?propertyId=${A}`).set(auth(t)).expect(200);
    expect(queue.enqueue).toHaveBeenCalledWith(OUTBOX_A);
  });

  it('a manager for A cannot retry or resolve B’s outbox row: 404, nothing queued', async () => {
    const t = await token(['pos_manager'], [A]);
    await http().post(`/outbox/${OUTBOX_B}/retry?propertyId=${A}`).set(auth(t)).expect(404);
    await http().post(`/outbox/${OUTBOX_B}/resolve?propertyId=${A}`).set(auth(t)).send({ resolutionType: 'written_off', note: 'Comped' }).expect(404);
    await http().post(`/outbox/${OUTBOX_B}/retry?propertyId=${B}`).set(auth(t)).expect(403);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('Resolve through the real pipe: type and note required; a charge id only with posted_manually', async () => {
    const t = await token(['pos_manager'], [A]);
    const resolve = (body: object) => http().post(`/outbox/${OUTBOX_A}/resolve?propertyId=${A}`).set(auth(t)).send(body);
    await resolve({}).expect(400);
    await resolve({ resolutionType: 'written_off' }).expect(400);
    await resolve({ resolutionType: 'written_off', note: '  ' }).expect(400);
    await resolve({ resolutionType: 'written_off', note: 'Comped', haipChargeId: 'chg-1' }).expect(400);
    await resolve({ resolutionType: 'written_off', note: 'Comped by the manager' }).expect(200);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('Retry takes an optional note through the real pipe', async () => {
    const t = await token(['pos_manager'], [A]);
    await http().post(`/outbox/${OUTBOX_A}/retry?propertyId=${A}`).set(auth(t)).send({ note: 'Room fixed' }).expect(200);
    await http().post(`/outbox/${OUTBOX_A}/retry?propertyId=${A}`).set(auth(t)).send({ unknown: 1 }).expect(400);
  });

  it('a manager for A cannot edit B’s menu item: 404', async () => {
    const t = await token(['pos_manager'], [A]);
    await http().patch(`/menu-items/${MENU_B}?propertyId=${A}`).set(auth(t)).send({ name: 'Coffee' }).expect(404);
  });
});
