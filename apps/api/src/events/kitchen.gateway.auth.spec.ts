import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Global, Logger, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import { AUTH_CONFIG, loadAuthConfig } from '../auth/auth.config.js';
import { AuthModule } from '../auth/auth.module.js';
import { TOKEN_VERIFIER, TokenVerifier } from '../auth/token-verifier.js';
import { EventsModule } from './events.module.js';
import { OrderEventsService } from './order-events.service.js';
import type { OrderWithItems } from '../orders/orders.service.js';
import { PROPERTY_DIRECTORY } from '../properties/properties.service.js';
import { DRIZZLE } from '../database/database.module.js';

/**
 * The real gateway on a local port, spoken to in raw Socket.IO (Engine.IO v4) over
 * Node's built-in WebSocket, so no client library is needed:
 *   40{auth}  connect with a token      → 40{sid} ok, or 44{message} refused
 *   42N[...]  emit with ack id N        → 43N[ack]
 *   42[...]   server event              41  server disconnect      2/3  ping/pong
 */
const ISSUER = 'http://localhost:8080/realms/haip';
const A = 'a0000001-0000-4000-a000-00000000000a';
const B = 'b0000002-0000-4000-a000-00000000000b';
/** Known to the token (property_ids) but not a registered hotel. */
const UNREGISTERED = 'c0000003-0000-4000-a000-00000000000c';

/** The hotels the API knows (PropertiesModule stand-in). */
@Global()
@Module({
  providers: [
    { provide: PROPERTY_DIRECTORY, useValue: { find: (id: string) => Promise.resolve([A, B].includes(id) ? { id } : null) } },
    // OutboxAlerts (in EventsModule) needs a database; its timer is off under NODE_ENV=test.
    { provide: DRIZZLE, useValue: {} },
  ],
  exports: [PROPERTY_DIRECTORY, DRIZZLE],
})
class KnownHotels {}

let app: INestApplication;
let url: string;
let key: CryptoKey;
let events: OrderEventsService;

function token(roles: string[], propertyIds: string[], expiresAt = Math.floor(Date.now() / 1000) + 300) {
  return new SignJWT({ azp: 'stayx-kms-web', preferred_username: 'kitchen-t1', resource_access: { 'stayx-pos-api': { roles } }, property_ids: propertyIds })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setAudience('stayx-pos-api')
    .setSubject('kitchen-t1-id')
    .setExpirationTime(expiresAt)
    .sign(key);
}

/** A minimal Socket.IO client: records every packet, answers pings. */
class RawSocket {
  readonly packets: string[] = [];
  private readonly ws: WebSocket;
  private ackId = 0;
  private closed = false;

  constructor(auth: Record<string, unknown> | undefined) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('message', (event) => {
      const data = String(event.data);
      if (data === '2') return this.ws.send('3');
      if (data.startsWith('0')) return this.ws.send(`40${auth ? JSON.stringify(auth) : ''}`);
      this.packets.push(data);
    });
    this.ws.addEventListener('close', () => (this.closed = true));
  }

  async next(match: (packet: string) => boolean, timeoutMs = 5000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.packets.find(match);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`timed out; got ${JSON.stringify(this.packets)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** 'ok' once connected, else the refusal message. */
  async connected(): Promise<string> {
    const packet = await this.next((p) => p.startsWith('40') || p.startsWith('44'));
    return packet.startsWith('40') ? 'ok' : (JSON.parse(packet.slice(2)) as { message: string }).message;
  }

  async emitWithAck(event: string, body: unknown): Promise<unknown> {
    const id = ++this.ackId;
    this.ws.send(`42${id}${JSON.stringify([event, body])}`);
    const packet = await this.next((p) => p.startsWith(`43${id}[`));
    return (JSON.parse(packet.slice(2 + String(id).length)) as unknown[])[0];
  }

  /** Server events received so far, as [name, payload]. */
  events(): [string, unknown][] {
    return this.packets.filter((p) => p.startsWith('42[')).map((p) => JSON.parse(p.slice(2)) as [string, unknown]);
  }

  isDisconnectedByServer() {
    return this.packets.includes('41') || this.closed;
  }

  close() {
    this.ws.close();
  }
}

beforeAll(async () => {
  for (const level of ['warn', 'log', 'debug'] as const) vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
  // No clock allowance here, so the expiry test needn't wait 30 s.
  const config = { ...loadAuthConfig({ POS_OIDC_ISSUER: ISSUER }), clockToleranceSeconds: 0 };

  const moduleRef = await Test.createTestingModule({ imports: [AuthModule, KnownHotels, EventsModule] })
    .overrideProvider(AUTH_CONFIG)
    .useValue(config)
    .overrideProvider(TOKEN_VERIFIER)
    .useValue(new TokenVerifier(config, jwks))
    .compile();
  app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  url = `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`;
  events = app.get(OrderEventsService);
});

afterAll(async () => {
  await app.close();
});

describe('kitchen socket with staff login on', () => {
  it('refuses a handshake without a token', async () => {
    const socket = new RawSocket(undefined);
    expect(await socket.connected()).toBe('unauthorized');
    socket.close();
  });

  it('refuses an invalid token with the same message', async () => {
    const socket = new RawSocket({ token: 'not-a-jwt' });
    expect(await socket.connected()).toBe('unauthorized');
    socket.close();
  });

  it('refuses a valid token without a POS role', async () => {
    const socket = new RawSocket({ token: await token(['some_haip_role'], [A]) });
    expect(await socket.connected()).toBe('forbidden');
    socket.close();
  });

  it('a hotel in the token but not registered: join refused as unknown', async () => {
    const socket = new RawSocket({ token: await token(['pos_kitchen'], [A, UNREGISTERED]) });
    expect(await socket.connected()).toBe('ok');
    expect(await socket.emitWithAck('joinProperty', { propertyId: UNREGISTERED })).toEqual({ ok: false, error: 'Unknown property' });
    expect(await socket.emitWithAck('joinProperty', { propertyId: A })).toEqual({ ok: true, room: `property:${A}` });
    socket.close();
  });

  it('a kitchen tablet for A joins A, is refused B, and only receives A’s orders', async () => {
    const socket = new RawSocket({ token: await token(['pos_kitchen'], [A]) });
    expect(await socket.connected()).toBe('ok');

    expect(await socket.emitWithAck('joinProperty', { propertyId: A })).toEqual({ ok: true, room: `property:${A}` });
    expect(await socket.emitWithAck('joinProperty', { propertyId: B })).toEqual({ ok: false, error: 'No access to this property' });

    events.emitOrderCreated({ id: 'order-b', propertyId: B } as OrderWithItems);
    events.emitOrderCreated({ id: 'order-a', propertyId: A } as OrderWithItems);
    await socket.next((p) => p.includes('order-a'));
    expect(socket.events()).toEqual([['order.created', { id: 'order-a', propertyId: A }]]);
    socket.close();
  });

  it('disconnects the socket when the token expires', async () => {
    const socket = new RawSocket({ token: await token(['pos_kitchen'], [A], Math.floor(Date.now() / 1000) + 2) });
    expect(await socket.connected()).toBe('ok');
    expect(socket.isDisconnectedByServer()).toBe(false);
    await socket.next((p) => p === '41', 5000);
    socket.close();
  });
});
