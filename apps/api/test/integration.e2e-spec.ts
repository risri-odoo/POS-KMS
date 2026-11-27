import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type postgres from 'postgres';
import { FakeHaip } from './fake-haip.js';
import { E2E_DATABASE, PG_SERVER, REDIS_DB, REDIS_PORT, createDatabase, dropDatabase, redis, waitFor } from './infra.js';

/**
 * End-to-end: the real AppModule (guards, services, BullMQ queue and worker) against a
 * throwaway Postgres database and Redis database 3, with a fake HAIP and identity
 * provider in-process. Replaces the boilerplate "Hello World" e2e.
 * Needs the docker-compose containers pos-postgres-1 and pos-redis-1. Run: pnpm test:e2e
 */
const HOTEL = 'a0000001-0000-4000-a000-000000000001';
const UNREGISTERED = 'c0000003-0000-4000-a000-00000000000c';
const RES_ADA = '6a000000-0000-4000-8000-0000000000a1';
const RES_MAX = '6a000000-0000-4000-8000-0000000000a2';
const HOTEL_KEY = 'e2e-folio-inbound-key';

const haip = new FakeHaip(HOTEL_KEY);
let app: INestApplication<App>;
let sql: postgres.Sql;
let teaId: string;

const http = () => request(app.getHttpServer());
const as = async (sub: string, roles: string[], props: string[] = [HOTEL], azp?: string) => ({
  Authorization: `Bearer ${await haip.token(sub, roles, props, azp)}`,
});
const staff = (sub = 'pos-staff-1') => as(sub, ['pos_staff']);
const kitchen = () => as('kitchen-t1', ['pos_kitchen'], [HOTEL], 'stayx-kms-web');
const manager = () => as('pos-manager-1', ['pos_manager']);

async function deliver(orderId: string) {
  for (const status of ['accepted', 'preparing', 'ready', 'delivered']) {
    await http().patch(`/api/v1/orders/${orderId}/status?propertyId=${HOTEL}`).set(await kitchen()).send({ status }).expect(200);
  }
}
const outboxFor = async (orderId: string) => {
  const rows = await sql`select * from haip_post_outbox where order_id = ${orderId}`;
  return rows[0];
};

beforeAll(async () => {
  for (const level of ['log', 'warn', 'debug'] as const) vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  await haip.start();
  sql = await createDatabase();
  await redis('FLUSHDB');

  // The demo hotel, as scripts/property.mjs registers it, and one menu item.
  await sql`insert into properties (id, name, currency_code, timezone, haip_api_key_env) values (${HOTEL}, 'Demo hotel', 'USD', 'America/New_York', 'HAIP_KEY_E2E')`;
  [{ id: teaId }] = await sql<{ id: string }[]>`insert into menu_items (property_id, name, price, currency_code) values (${HOTEL}, 'Green tea', '5.00', 'USD') returning id`;
  haip.reservations.set(RES_ADA, { id: RES_ADA, propertyId: HOTEL, roomNumber: '101', status: 'checked_in', departureDate: '2026-12-01', folioId: 'f0000000-0000-4000-8000-0000000000f1', guests: [{ firstName: 'Ada', lastName: 'Lovelace' }] });
  haip.reservations.set(RES_MAX, { id: RES_MAX, propertyId: HOTEL, roomNumber: '102', status: 'checked_in', departureDate: '2026-12-01', folioId: 'f0000000-0000-4000-8000-0000000000f2', guests: [{ firstName: 'Max', lastName: 'Planck' }] });

  // Configuration as for a real deployment, pointed at the fakes. Real env wins over pos/.env.
  Object.assign(process.env, {
    NODE_ENV: 'development', // the queue and worker are off under NODE_ENV=test
    DATABASE_URL: `${PG_SERVER}/${E2E_DATABASE}`,
    REDIS_URL: `redis://127.0.0.1:${REDIS_PORT}/${REDIS_DB}`,
    POS_AUTH_ENABLED: 'true',
    POS_OIDC_ISSUER: haip.issuer,
    HAIP_BRIDGE_ENABLED: 'true',
    HAIP_API_URL: `${haip.url}/api/v1`,
    HAIP_KEY_E2E: HOTEL_KEY,
    HAIP_STAY_LOOKUP: 'haip',
    HAIP_STAFF_API_URL: `${haip.url}/api/v1`,
    HAIP_SP_TOKEN_URL: `${haip.issuer}/protocol/openid-connect/token`,
    HAIP_SP_CLIENT_ID: 'stayx-pos',
    HAIP_SP_CLIENT_SECRET: 'not-a-real-secret',
    STAY_LOOKUP_RATE_LIMIT_MAX: '3',
    STAY_LOOKUP_RATE_LIMIT_WINDOW_MS: '60000',
  });
  const { AppModule } = await import('../src/app.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await redis('FLUSHDB').catch(() => undefined);
  if (sql) await dropDatabase(sql);
  await haip.stop();
}, 60_000);

describe('integration: real API, Postgres, Redis; fake HAIP', () => {
  it('health: ready with the database and Redis up', async () => {
    const res = await http().get('/api/v1/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' }, outbox: { oldestPendingMinutes: null } });
  });

  it('no token: 401; a hotel in the token but not registered: 404', async () => {
    await http().get(`/api/v1/orders?propertyId=${HOTEL}`).expect(401);
    await http().get(`/api/v1/orders?propertyId=${UNREGISTERED}`).set(await as('pos-staff-1', ['pos_staff'], [HOTEL, UNREGISTERED])).expect(404);
  });

  it('confirm the guest → order → kitchen delivers → posted to the bound folio with the hotel’s key', async () => {
    const lookup = await http().get(`/api/v1/stays/lookup?propertyId=${HOTEL}&roomNumber=101`).set(await staff()).expect(200);
    expect(lookup.body).toMatchObject({ status: 'found', stays: [{ reservationId: RES_ADA, guests: [{ displayName: 'Ada L.' }] }] });

    const order = await http()
      .post('/api/v1/orders')
      .set(await staff())
      .send({ propertyId: HOTEL, roomNumber: '101', items: [{ menuItemId: teaId, quantity: 2 }], reservationId: RES_ADA, confirmedGuestName: 'Ada L.', placedBy: 'spoofed' })
      .expect(201);
    expect(order.body).toMatchObject({ placedBy: 'pos-staff-1', verificationStatus: 'verified', haipReservationId: RES_ADA, subtotal: '10.00', currencyCode: 'USD' });

    await deliver(order.body.id as string);
    const row = await waitFor('the charge to be posted', async () => {
      const r = await outboxFor(order.body.id as string);
      return r?.status === 'posted' ? r : null;
    });
    expect(row).toMatchObject({ haip_charge_id: 'chg-1', parked_reason: null });
    expect(haip.charges).toHaveLength(1);
    expect(haip.charges[0]!.apiKey).toBe(HOTEL_KEY);
    expect(haip.charges[0]!.body).toMatchObject({ roomNumber: '101', amount: '10.00', currencyCode: 'USD', vendorTxnId: `stayx-rs-${order.body.id}` });

    // Posted: Retry is refused and HAIP is not charged again.
    await http().post(`/api/v1/outbox/${row.id}/retry?propertyId=${HOTEL}`).set(await manager()).expect(400);
    const list = await http().get(`/api/v1/outbox?propertyId=${HOTEL}&view=all`).set(await manager()).expect(200);
    expect(list.body.find((e: { id: string }) => e.id === row.id)).toMatchObject({ status: 'posted', retryAllowed: false, order: { roomNumber: '101', guestName: 'Ada L.' } });
    expect(haip.charges).toHaveLength(1);
  }, 60_000);

  it('the stay ends before posting → parked stay_ended; Retry 409; Resolve with a note → resolved; nothing charged', async () => {
    const order = await http()
      .post('/api/v1/orders')
      .set(await staff())
      .send({ propertyId: HOTEL, roomNumber: '102', items: [{ menuItemId: teaId, quantity: 1 }], reservationId: RES_MAX, confirmedGuestName: 'Max P.' })
      .expect(201);
    haip.reservations.get(RES_MAX)!.status = 'checked_out';
    await deliver(order.body.id as string);

    const row = await waitFor('the charge to be parked', async () => {
      const r = await outboxFor(order.body.id as string);
      return r?.status === 'needs_attention' ? r : null;
    });
    expect(row.parked_reason).toBe('stay_ended');

    const attention = await http().get(`/api/v1/outbox?propertyId=${HOTEL}`).set(await manager()).expect(200);
    expect(attention.body.map((e: { id: string; retryAllowed: boolean }) => [e.id, e.retryAllowed])).toEqual([[row.id, false]]);
    await http().post(`/api/v1/outbox/${row.id}/retry?propertyId=${HOTEL}`).set(await manager()).expect(409);
    const before = await http().get(`/api/v1/outbox/summary?propertyId=${HOTEL}`).set(await manager()).expect(200);
    expect(before.body).toMatchObject({ needsAttention: 1, failed: 0, stuck: 0, total: 1, bridgeEnabled: true });

    const resolved = await http()
      .post(`/api/v1/outbox/${row.id}/resolve?propertyId=${HOTEL}`)
      .set(await manager())
      .send({ resolutionType: 'collected_otherwise', note: 'Paid at the front desk at checkout' })
      .expect(200);
    expect(resolved.body).toMatchObject({ status: 'resolved', resolutionType: 'collected_otherwise', resolvedBy: 'pos-manager-1', postedAt: null });
    expect(haip.charges).toHaveLength(1); // still only the first order's charge
    const after = await http().get(`/api/v1/outbox/summary?propertyId=${HOTEL}`).set(await manager()).expect(200);
    expect(after.body).toMatchObject({ total: 0 });
  }, 60_000);

  it('an order priced in another currency than the hotel’s is refused and nothing is written', async () => {
    const [{ id: eurTea }] = await sql<{ id: string }[]>`insert into menu_items (property_id, name, price, currency_code) values (${HOTEL}, 'Euro tea', '4.00', 'EUR') returning id`;
    const before = await sql`select count(*)::int as n from orders`;
    const res = await http()
      .post('/api/v1/orders')
      .set(await staff())
      .send({ propertyId: HOTEL, roomNumber: '101', items: [{ menuItemId: eurTea, quantity: 1 }], reservationId: RES_ADA, confirmedGuestName: 'Ada L.' })
      .expect(400);
    expect(res.body.message).toContain('priced in EUR, but Demo hotel uses USD');
    expect(await sql`select count(*)::int as n from orders`).toEqual(before);
  });

  it('stay-lookup limit: per signed-in user, counted in the real Redis', async () => {
    const lookup = async (sub: string) =>
      (await http().get(`/api/v1/stays/lookup?propertyId=${HOTEL}&roomNumber=101`).set(await staff(sub))).status;
    // Both from 127.0.0.1, as terminals behind one hotel IP would be.
    expect([await lookup('carol'), await lookup('carol'), await lookup('carol'), await lookup('carol')]).toEqual([200, 200, 200, 429]);
    expect([await lookup('dave'), await lookup('dave'), await lookup('dave')]).toEqual([200, 200, 200]);

    expect(await redis('GET', 'stayx:stay-lookup:user:carol')).toBe('4');
    const ttl = (await redis('PTTL', 'stayx:stay-lookup:user:carol')) as number;
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
    expect(await redis('GET', 'stayx:stay-lookup:user:dave')).toBe('3');
  }, 30_000);
});
