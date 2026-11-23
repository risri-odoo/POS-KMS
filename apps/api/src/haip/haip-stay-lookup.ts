import {
  isInHouseStatus,
  type InHouseStay,
  type RoomLookupResult,
  type StayLookup,
  type StayLookupResult,
  type StayOccupant,
} from './stay-lookup.js';

/**
 * StayLookup over HAIP's staff REST API with a service principal (client-credentials
 * JWT), until HAIP ships R1/R2 (INTEGRATION_DESIGN.md §5.2). Only these reads are used:
 *
 *   GET /reservations?propertyId&statuses=checked_in,stayover,due_out&page&limit  (paged)
 *   GET /reservations/:id?propertyId
 *   GET /reservations/:id/guests?propertyId
 *   GET /folios?propertyId&reservationId&type=guest&status=open   (needs folios.read)
 *
 * Privacy: some of these responses carry full guest records (phone, email). The
 * adapter reads only first name, surname initial, status, room, departure and
 * folio id, drops the rest, and never logs or returns a response body.
 */
export interface HaipStayLookupOptions {
  /** HAIP staff REST base, e.g. http://localhost:3001/api/v1 */
  apiUrl: string;
  /** e.g. http://localhost:8080/realms/haip/protocol/openid-connect/token */
  tokenUrl: string;
  clientId: string;
  /** Never logged or returned. */
  clientSecret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Reservations per page when scanning in-house stays (HAIP's maximum is 100). */
  pageSize?: number;
  /** Safety cap on pages scanned per lookup. */
  maxPages?: number;
  now?: () => number;
}

const IN_HOUSE = 'checked_in,stayover,due_out';
const TOKEN_EARLY_REFRESH_MS = 30_000;

/** A failure that means "HAIP couldn't be asked"; the message is safe to log. */
class HaipUnavailable extends Error {}
class NotFound extends Error {}

interface Token {
  value: string;
  expiresAt: number;
}

export class HaipStayLookup implements StayLookup {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly now: () => number;
  private token: Token | null = null;

  constructor(private readonly options: HaipStayLookupOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.pageSize = Math.min(100, Math.max(1, options.pageSize ?? 100));
    this.maxPages = options.maxPages ?? 50;
    this.now = options.now ?? (() => Date.now());
  }

  async findInHouseByRoom(propertyId: string, roomNumber: string): Promise<RoomLookupResult> {
    const room = roomNumber.trim();
    try {
      const matches: Array<{ id: string; departureDate: string }> = [];
      for (let page = 1; page <= this.maxPages; page++) {
        const body = await this.get(
          `/reservations?propertyId=${q(propertyId)}&statuses=${IN_HOUSE}&page=${page}&limit=${this.pageSize}`,
        );
        const data = Array.isArray(body?.data) ? body.data : [];
        for (const r of data) {
          if (r?.propertyId === propertyId && String(r?.roomNumber ?? '') === room && isInHouseStatus(String(r?.status))) {
            matches.push({ id: String(r.id), departureDate: dateOnly(r.departureDate) });
          }
        }
        if (!body?.hasMore) break;
        if (page === this.maxPages) throw new HaipUnavailable(`more than ${this.maxPages} pages of in-house reservations`);
      }
      if (matches.length === 0) return { kind: 'none' };

      const stays: InHouseStay[] = [];
      for (const m of matches) {
        stays.push({
          reservationId: m.id,
          roomNumber: room,
          departureDate: m.departureDate,
          guestFolioId: await this.openGuestFolio(propertyId, m.id),
          occupants: await this.occupants(propertyId, m.id),
        });
      }
      return { kind: 'found', stays };
    } catch (error) {
      return { kind: 'unavailable', reason: reasonOf(error) };
    }
  }

  async getStay(propertyId: string, reservationId: string): Promise<StayLookupResult> {
    try {
      let body: any;
      try {
        body = await this.get(`/reservations/${q(reservationId)}?propertyId=${q(propertyId)}`);
      } catch (error) {
        if (error instanceof NotFound) return { kind: 'not_found' };
        throw error;
      }
      const reservation = body?.reservation;
      if (!reservation || reservation.propertyId !== propertyId) return { kind: 'not_found' };
      const status = String(reservation.status ?? '');
      return {
        kind: 'found',
        stay: {
          reservationId: String(reservation.id ?? reservationId),
          status,
          inHouse: isInHouseStatus(status),
          roomNumber: typeof body?.room?.number === 'string' ? body.room.number : null,
          departureDate: dateOnly(reservation.departureDate),
          guestFolioId: await this.openGuestFolio(propertyId, reservationId),
        },
      };
    } catch (error) {
      return { kind: 'unavailable', reason: reasonOf(error) };
    }
  }

  private async occupants(propertyId: string, reservationId: string): Promise<StayOccupant[]> {
    const body = await this.get(`/reservations/${q(reservationId)}/guests?propertyId=${q(propertyId)}`);
    const rows: any[] = Array.isArray(body) ? body : [];
    // Primary guest first, as HAIP orders them.
    return rows
      .map((g) => ({
        firstName: typeof g?.firstName === 'string' ? g.firstName.trim() : '',
        lastInitial: typeof g?.lastName === 'string' ? g.lastName.trim().charAt(0).toUpperCase() : '',
      }))
      .filter((g) => g.firstName !== '');
  }

  private async openGuestFolio(propertyId: string, reservationId: string): Promise<string | null> {
    const body = await this.get(
      `/folios?propertyId=${q(propertyId)}&reservationId=${q(reservationId)}&type=guest&status=open&limit=1`,
    );
    const first = Array.isArray(body?.data) ? body.data[0] : undefined;
    return typeof first?.id === 'string' ? first.id : null;
  }

  /** GET with the service-principal token; refreshes the token once on 401. */
  private async get(path: string): Promise<any> {
    for (let attempt = 1; ; attempt++) {
      const token = await this.accessToken(attempt > 1);
      const res = await this.send(`${this.options.apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (res.status === 401 && attempt === 1) continue;
      if (res.status === 404) throw new NotFound();
      if (!res.ok) throw new HaipUnavailable(`HAIP answered HTTP ${res.status} for ${pathOnly(path)}`);
      try {
        return await res.json();
      } catch {
        throw new HaipUnavailable(`HAIP sent an unreadable response for ${pathOnly(path)}`);
      }
    }
  }

  private async accessToken(forceRefresh: boolean): Promise<string> {
    if (!forceRefresh && this.token && this.token.expiresAt - TOKEN_EARLY_REFRESH_MS > this.now()) return this.token.value;
    const res = await this.send(this.options.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
      }).toString(),
    });
    if (!res.ok) throw new HaipUnavailable(`token endpoint answered HTTP ${res.status}`);
    const body: any = await res.json().catch(() => null);
    if (typeof body?.access_token !== 'string') throw new HaipUnavailable('token endpoint returned no access_token');
    const ttlSeconds = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 60;
    this.token = { value: body.access_token, expiresAt: this.now() + ttlSeconds * 1000 };
    return this.token.value;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
    } catch (error) {
      const timedOut = (error as { name?: string } | null)?.name === 'TimeoutError';
      throw new HaipUnavailable(timedOut ? `no answer within ${this.timeoutMs / 1000}s` : 'could not connect');
    }
  }
}

const q = encodeURIComponent;

/** "2026-12-01T00:00:00.000Z" or "2026-12-01" → "2026-12-01". */
function dateOnly(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

/** The path without its query, for messages. */
function pathOnly(path: string): string {
  return path.split('?')[0]!.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id');
}

function reasonOf(error: unknown): string {
  return error instanceof HaipUnavailable ? error.message : 'unexpected error while reading HAIP';
}
