import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import { AppController } from '../app.controller.js';
import { AppService } from '../app.service.js';
import { AUTH_CONFIG, loadAuthConfig, type AuthConfig } from '../auth/auth.config.js';
import { AuthModule } from '../auth/auth.module.js';
import { TOKEN_VERIFIER, TokenVerifier } from '../auth/token-verifier.js';
import { OrdersController } from '../orders/orders.controller.js';
import { OrdersService } from '../orders/orders.service.js';
import { PropertiesModule } from './properties.module.js';
import { PropertiesService } from './properties.service.js';

/**
 * The real global guards in AppModule's order (AuthModule, then PropertiesModule):
 * login, roles, then "is this a known hotel".
 */
const ISSUER = 'http://localhost:8080/realms/haip';
const A = 'a0000001-0000-4000-a000-000000000001';
const UNREGISTERED = 'c0000003-0000-4000-a000-00000000000c';
const orders = { list: vi.fn().mockResolvedValue([]) };
const known = {
  find: (id: string) =>
    Promise.resolve(id === A ? { id, name: 'Demo hotel', currencyCode: 'USD', timezone: 'America/New_York', haipApiKeyEnv: 'HAIP_KEY_DEMO', active: true } : null),
};

async function appWith(config: AuthConfig, jwks?: ReturnType<typeof createLocalJWKSet>) {
  let builder = Test.createTestingModule({
    imports: [AuthModule, PropertiesModule],
    controllers: [AppController, OrdersController],
    providers: [AppService, { provide: OrdersService, useValue: orders }],
  })
    .overrideProvider(AUTH_CONFIG)
    .useValue(config)
    .overrideProvider(PropertiesService)
    .useValue(known);
  if (jwks) builder = builder.overrideProvider(TOKEN_VERIFIER).useValue(new TokenVerifier(config, jwks));
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return app;
}

let on: INestApplication<App>;
let off: INestApplication<App>;
let key: CryptoKey;

const token = (propertyIds: string[]) =>
  new SignJWT({ azp: 'stayx-pos-web', preferred_username: 'pos-staff-1', resource_access: { 'stayx-pos-api': { roles: ['pos_staff'] } }, property_ids: propertyIds })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setAudience('stayx-pos-api')
    .setSubject('s1')
    .setExpirationTime('5m')
    .sign(key);

beforeAll(async () => {
  for (const level of ['warn', 'log'] as const) vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
  on = await appWith(loadAuthConfig({ POS_OIDC_ISSUER: ISSUER }), jwks);
  off = await appWith(loadAuthConfig({ POS_AUTH_ENABLED: 'false' }));
});

afterAll(async () => {
  await on.close();
  await off.close();
});

describe('known hotels (login on)', () => {
  it('a registered hotel in the token: allowed', async () => {
    await request(on.getHttpServer()).get(`/orders?propertyId=${A}`).set('Authorization', `Bearer ${await token([A])}`).expect(200);
  });

  it('in the token but not a registered hotel: 404 Unknown property', async () => {
    const res = await request(on.getHttpServer())
      .get(`/orders?propertyId=${UNREGISTERED}`)
      .set('Authorization', `Bearer ${await token([A, UNREGISTERED])}`)
      .expect(404);
    expect(res.body.message).toBe('Unknown property');
  });

  it('without a token the answer is 401, never 404: nobody can probe which hotels exist', async () => {
    await request(on.getHttpServer()).get(`/orders?propertyId=${UNREGISTERED}`).expect(401);
  });

  it('a hotel not in the token: 403 from the role check, before the hotel check', async () => {
    await request(on.getHttpServer()).get(`/orders?propertyId=${UNREGISTERED}`).set('Authorization', `Bearer ${await token([A])}`).expect(403);
  });

  it('public routes are not checked', async () => {
    await request(on.getHttpServer()).get('/').expect(200);
  });
});

describe('known hotels (login off)', () => {
  it('still refuses an unknown hotel', async () => {
    await request(off.getHttpServer()).get(`/orders?propertyId=${UNREGISTERED}`).expect(404);
    await request(off.getHttpServer()).get(`/orders?propertyId=${A}`).expect(200);
  });

  it('a repeated propertyId is refused (400), so a second hotel can’t ride along', async () => {
    await request(off.getHttpServer()).get(`/orders?propertyId=${A}&propertyId=${UNREGISTERED}`).expect(400);
  });
});

describe('AppModule', () => {
  it('registers AuthModule before PropertiesModule, so the hotel check runs after login', async () => {
    const { AppModule } = await import('../app.module.js');
    const imports = Reflect.getMetadata('imports', AppModule) as unknown[];
    expect(imports.indexOf(AuthModule)).toBeGreaterThanOrEqual(0);
    expect(imports.indexOf(AuthModule)).toBeLessThan(imports.indexOf(PropertiesModule));
  });
});

describe('GET /properties/current', () => {
  it('gives the hotel’s name, currency and timezone to any POS role, never its key variable', async () => {
    const res = await request(off.getHttpServer()).get(`/properties/current?propertyId=${A}`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['currencyCode', 'id', 'name', 'timezone']);
    expect(JSON.stringify(res.body)).not.toContain('HAIP_KEY');
  });

  it('is behind login like every other route', async () => {
    await request(on.getHttpServer()).get(`/properties/current?propertyId=${A}`).expect(401);
  });
});
