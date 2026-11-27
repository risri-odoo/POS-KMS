import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';

/**
 * In-process stand-ins for the integration test: HAIP (service-principal token, the staff
 * REST the stay lookup reads, folio-inbound charges) and the identity provider's signing
 * keys for staff tokens. Nothing here talks to a real HAIP or Keycloak.
 */
export interface FakeReservation {
  id: string;
  propertyId: string;
  roomNumber: string;
  status: string;
  departureDate: string;
  folioId: string;
  guests: { firstName: string; lastName: string }[];
}

export interface ReceivedCharge {
  apiKey: string | undefined;
  body: Record<string, unknown>;
}

export class FakeHaip {
  readonly reservations = new Map<string, FakeReservation>();
  readonly charges: ReceivedCharge[] = [];
  /** The folio-inbound key HAIP expects (one hotel). */
  constructor(readonly expectedKey: string) {}

  private server = http.createServer((req, res) => void this.handle(req, res));
  private signingKey!: CryptoKey;
  private jwk!: JWK;
  url = '';

  get issuer() {
    return `${this.url}/realms/e2e`;
  }

  async start(): Promise<void> {
    const pair = await generateKeyPair('RS256');
    this.signingKey = pair.privateKey;
    this.jwk = { ...(await exportJWK(pair.publicKey)), kid: 'e2e', alg: 'RS256', use: 'sig' };
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /** A staff access token as Keycloak would issue it for stayx-pos-web / stayx-kms-web. */
  token(sub: string, roles: string[], propertyIds: string[], azp = 'stayx-pos-web'): Promise<string> {
    return new SignJWT({ azp, preferred_username: sub, resource_access: { 'stayx-pos-api': { roles } }, property_ids: propertyIds })
      .setProtectedHeader({ alg: 'RS256', kid: 'e2e' })
      .setIssuer(this.issuer)
      .setAudience('stayx-pos-api')
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(this.signingKey);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', this.url);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const body = await new Promise<string>((resolve) => {
      let d = '';
      req.on('data', (c: Buffer) => (d += c.toString()));
      req.on('end', () => resolve(d));
    });

    // Identity provider: signing keys and the service-principal token.
    if (url.pathname === '/realms/e2e/protocol/openid-connect/certs') return json(200, { keys: [this.jwk] });
    if (url.pathname === '/realms/e2e/protocol/openid-connect/token' && req.method === 'POST') {
      return json(200, { access_token: 'sp-token', token_type: 'Bearer', expires_in: 300 });
    }

    // HAIP staff REST (service principal), as HaipStayLookup reads it.
    if (url.pathname.startsWith('/api/v1/') && !url.pathname.startsWith('/api/v1/folio-inbound')) {
      if (req.headers.authorization !== 'Bearer sp-token') return json(401, { message: 'no token' });
      const propertyId = url.searchParams.get('propertyId');
      const inHouse = (r: FakeReservation) => ['checked_in', 'stayover', 'due_out'].includes(r.status);
      if (url.pathname === '/api/v1/reservations') {
        const data = [...this.reservations.values()].filter((r) => r.propertyId === propertyId && inHouse(r));
        return json(200, { data, hasMore: false });
      }
      const guests = url.pathname.match(/^\/api\/v1\/reservations\/([^/]+)\/guests$/);
      if (guests) return json(200, this.reservations.get(guests[1]!)?.guests ?? []);
      const one = url.pathname.match(/^\/api\/v1\/reservations\/([^/]+)$/);
      if (one) {
        const r = this.reservations.get(one[1]!);
        if (!r || r.propertyId !== propertyId) return json(404, { message: 'not found' });
        return json(200, { reservation: { id: r.id, propertyId: r.propertyId, status: r.status, departureDate: r.departureDate }, room: { number: r.roomNumber } });
      }
      if (url.pathname === '/api/v1/folios') {
        const r = this.reservations.get(url.searchParams.get('reservationId') ?? '');
        return json(200, { data: r && inHouse(r) ? [{ id: r.folioId }] : [] });
      }
    }

    // HAIP folio-inbound: posts by room, with the hotel's key.
    if (url.pathname === '/api/v1/folio-inbound/charges' && req.method === 'POST') {
      const apiKey = req.headers['x-api-key'] as string | undefined;
      const charge = JSON.parse(body || '{}') as Record<string, unknown>;
      this.charges.push({ apiKey, body: charge });
      if (apiKey !== this.expectedKey) return json(401, { message: 'Invalid API key' });
      return json(201, { id: `chg-${this.charges.length}` });
    }
    return json(404, { message: `fake HAIP has no ${req.method} ${url.pathname}` });
  }
}
