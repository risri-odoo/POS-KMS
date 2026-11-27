import { classifyResponse, type InboundCharge } from './charge-mapper.js';

export type HaipPostResult =
  | { kind: 'created'; chargeId: string | null }
  | { kind: 'rejected'; status: number; message: string }
  | { kind: 'unavailable'; status?: number; message: string };

export interface HaipClientOptions {
  apiUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_MESSAGE = 500;

/**
 * Thin client for HAIP's POST /folio-inbound/charges. Never throws for HTTP or
 * network failures, and never puts the API key into any returned message.
 */
export class HaipClient {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HaipClientOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** @param apiKey the hotel's folio-inbound key (from its HAIP_KEY_* variable). */
  async postCharge(charge: InboundCharge, apiKey: string): Promise<HaipPostResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.options.apiUrl}/folio-inbound/charges`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(charge),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      const timedOut = (error as { name?: string } | null)?.name === 'TimeoutError';
      return {
        kind: 'unavailable',
        message: timedOut
          ? `HAIP did not respond within ${this.timeoutMs / 1000}s`
          : `Could not reach HAIP: ${this.clean((error as Error)?.message ?? 'network error', apiKey)}`,
      };
    }

    const body = await res.text().catch(() => '');
    const outcome = classifyResponse(res.status);
    if (outcome === 'posted') {
      return { kind: 'created', chargeId: this.chargeIdFrom(body) };
    }
    const message = this.messageFrom(res.status, body, apiKey);
    return outcome === 'terminal'
      ? { kind: 'rejected', status: res.status, message }
      : { kind: 'unavailable', status: res.status, message };
  }

  private chargeIdFrom(body: string): string | null {
    try {
      const id = (JSON.parse(body) as { id?: unknown }).id;
      return typeof id === 'string' && id.length <= 64 ? id : null;
    } catch {
      return null;
    }
  }

  private messageFrom(status: number, body: string, apiKey: string): string {
    let detail = '';
    try {
      const msg = (JSON.parse(body) as { message?: unknown }).message;
      detail = Array.isArray(msg) ? msg.filter((m) => typeof m === 'string').join('; ') : typeof msg === 'string' ? msg : '';
    } catch {
      detail = body;
    }
    return this.clean(`HTTP ${status}${detail ? `: ${detail}` : ''}`, apiKey);
  }

  /** Trim, cap length and redact the hotel's key in case anything ever echoes it back. */
  private clean(text: string, apiKey: string): string {
    const redacted = apiKey ? text.split(apiKey).join('[redacted]') : text;
    return redacted.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);
  }
}
