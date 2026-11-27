import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AUTH_CONFIG, loadAuthConfig } from '../auth/auth.config.js';
import { AuthModule } from '../auth/auth.module.js';
import { TOKEN_VERIFIER, type TokenVerifier } from '../auth/token-verifier.js';
import { HealthController } from './health.controller.js';
import { HealthService, type Readiness } from './health.service.js';

/** The real guards with staff login ON: probes have no token and must still get through. */
let app: INestApplication<App>;
const readiness = vi.fn<() => Promise<Readiness>>();

beforeAll(async () => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const config = loadAuthConfig({ POS_OIDC_ISSUER: 'http://localhost:8080/realms/haip' });
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule],
    controllers: [HealthController],
    providers: [{ provide: HealthService, useValue: { readiness } }],
  })
    .overrideProvider(AUTH_CONFIG)
    .useValue(config)
    .overrideProvider(TOKEN_VERIFIER)
    .useValue({ verify: vi.fn().mockRejectedValue(new Error('no token expected')) } as unknown as TokenVerifier)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('health routes (login on)', () => {
  it('GET /health: 200 without a token, checks nothing', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(readiness).not.toHaveBeenCalled();
  });

  it('GET /health/ready: 200 when ready, without a token', async () => {
    readiness.mockResolvedValueOnce({ status: 'ok', checks: { database: 'up', redis: 'not_used' }, outbox: { oldestPendingMinutes: 3 } });
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'not_used' }, outbox: { oldestPendingMinutes: 3 } });
  });

  it('GET /health/ready: 503 naming the part that is down', async () => {
    readiness.mockResolvedValueOnce({ status: 'unavailable', checks: { database: 'down', redis: 'up' }, outbox: { oldestPendingMinutes: null } });
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(res.body).toEqual({ status: 'unavailable', checks: { database: 'down', redis: 'up' }, outbox: { oldestPendingMinutes: null } });
  });
});
