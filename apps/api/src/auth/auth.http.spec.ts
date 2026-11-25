import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import { AppController } from '../app.controller.js';
import { AppService } from '../app.service.js';
import { OrdersController } from '../orders/orders.controller.js';
import { OrdersService } from '../orders/orders.service.js';
import { AUTH_CONFIG, loadAuthConfig } from './auth.config.js';
import { AuthModule } from './auth.module.js';
import { TOKEN_VERIFIER, TokenVerifier } from './token-verifier.js';

/**
 * The real Nest pipeline: both global guards in their registered order, then the
 * same ValidationPipe as main.ts. Tokens are signed with a key made here; no Keycloak.
 */
const ISSUER = 'http://localhost:8080/realms/haip';
const P1 = 'a0000001-0000-4000-a000-000000000001';
const P2 = 'a0000002-0000-4000-a000-000000000002';
const ORDER = { propertyId: P1, roomNumber: '101', unverified: true, items: [{ menuItemId: '44444444-4444-4444-8444-444444444444', quantity: 1 }] };

let app: INestApplication<App>;
let key: CryptoKey;
const orders = { create: vi.fn().mockResolvedValue({ id: 'o1' }), list: vi.fn().mockResolvedValue([]), updateStatus: vi.fn(), findById: vi.fn() };

function token(username: string, roles: string[], propertyIds: string[], azp = 'stayx-pos-web') {
  return new SignJWT({ azp, preferred_username: username, resource_access: { 'stayx-pos-api': { roles } }, property_ids: propertyIds })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setAudience('stayx-pos-api')
    .setSubject(`${username}-id`)
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
    controllers: [AppController, OrdersController],
    providers: [AppService, { provide: OrdersService, useValue: orders }],
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

afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());

describe('staff login over HTTP', () => {
  it('GET / needs no token', async () => {
    await http().get('/').expect(200);
  });

  it('401 without a token, before validation or the handler', async () => {
    await http().get('/orders').expect(401);
    await http().post('/orders').send({}).expect(401);
    expect(orders.list).not.toHaveBeenCalled();
  });

  it('staff place an order; placedBy is their username, not the body’s', async () => {
    const t = await token('pos-staff-1', ['pos_staff'], [P1]);
    await http().post('/orders').set('Authorization', `Bearer ${t}`).send({ ...ORDER, placedBy: 'spoofed' }).expect(201);
    expect(orders.create).toHaveBeenLastCalledWith(expect.objectContaining({ placedBy: 'spoofed' }), expect.objectContaining({ username: 'pos-staff-1' }));
  });

  it('403 for staff ordering into another hotel (property in the body)', async () => {
    const t = await token('pos-staff-1', ['pos_staff'], [P1]);
    const res = await http().post('/orders').set('Authorization', `Bearer ${t}`).send({ ...ORDER, propertyId: P2 }).expect(403);
    expect(res.body.message).toBe('No access to this property');
  });

  it('the kitchen tablet reads orders and changes status, but cannot place orders', async () => {
    const t = await token('kitchen-t1', ['pos_kitchen'], [P1], 'stayx-kms-web');
    await http().get(`/orders?propertyId=${P1}`).set('Authorization', `Bearer ${t}`).expect(200);
    await http().post('/orders').set('Authorization', `Bearer ${t}`).send(ORDER).expect(403);
  });

  it('staff cannot change order status', async () => {
    const t = await token('pos-staff-1', ['pos_staff'], [P1]);
    await http()
      .patch(`/orders/33333333-3333-4333-8333-333333333333/status?propertyId=${P1}`)
      .set('Authorization', `Bearer ${t}`)
      .send({ status: 'accepted' })
      .expect(403);
    expect(orders.updateStatus).not.toHaveBeenCalled();
  });

  it('400 for a repeated propertyId, so a second hotel cannot ride along', async () => {
    const t = await token('pos-staff-1', ['pos_staff'], [P1]);
    await http().get(`/orders?propertyId=${P1}&propertyId=${P2}`).set('Authorization', `Bearer ${t}`).expect(400);
  });
});
