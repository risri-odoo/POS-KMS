import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import { AUTH_CONFIG, loadAuthConfig } from '../auth/auth.config.js';
import { AuthModule } from '../auth/auth.module.js';
import { TOKEN_VERIFIER, TokenVerifier } from '../auth/token-verifier.js';
import { FakeStayLookup } from '../haip/fake-stay-lookup.js';
import { STAY_LOOKUP } from '../haip/stay-lookup.js';
import { STAY_LOOKUP_RATE_LIMIT, StayLookupRateLimitGuard } from './stay-lookup-rate-limit.guard.js';
import { StaysController } from './stays.controller.js';

/** The real route guard after the real global login guards: every call comes from 127.0.0.1. */
const ISSUER = 'http://localhost:8080/realms/haip';
const A = 'a0000001-0000-4000-a000-000000000001';
let app: INestApplication<App>;
let key: CryptoKey;

const token = (sub: string) =>
  new SignJWT({ azp: 'stayx-pos-web', preferred_username: sub, resource_access: { 'stayx-pos-api': { roles: ['pos_staff'] } }, property_ids: [A] })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setAudience('stayx-pos-api')
    .setSubject(sub)
    .setExpirationTime('5m')
    .sign(key);

beforeAll(async () => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
  const config = loadAuthConfig({ POS_OIDC_ISSUER: ISSUER });
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule],
    controllers: [StaysController],
    providers: [
      { provide: STAY_LOOKUP, useValue: new FakeStayLookup([]) },
      { provide: STAY_LOOKUP_RATE_LIMIT, useValue: { max: 2, windowMs: 60_000 } },
      StayLookupRateLimitGuard,
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

afterAll(async () => {
  await app.close();
});

describe('stay-lookup limit over HTTP (login on)', () => {
  it('two staff at the same hotel IP each get their own limit', async () => {
    const lookup = async (sub: string) =>
      (await request(app.getHttpServer()).get(`/stays/lookup?propertyId=${A}&roomNumber=101`).set('Authorization', `Bearer ${await token(sub)}`)).status;
    expect([await lookup('alice'), await lookup('alice'), await lookup('alice')]).toEqual([200, 200, 429]);
    expect([await lookup('bob'), await lookup('bob')]).toEqual([200, 200]);
  });
});
