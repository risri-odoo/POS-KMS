import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import type { Server, Socket } from 'socket.io';
import { allowOrigin } from '../common/cors.js';
import { AUTH_CONFIG, type AuthConfig } from '../auth/auth.config.js';
import { POS_ROLES } from '../auth/roles.decorator.js';
import { InvalidTokenError, TOKEN_VERIFIER, type AuthPrincipal, type TokenVerifier } from '../auth/token-verifier.js';
import { PROPERTY_DIRECTORY, type PropertyDirectory } from '../properties/properties.service.js';

/** The Socket.IO room for one property. The only place the room name is built. */
export function roomFor(propertyId: string): string {
  return `property:${propertyId}`;
}

export type RoomAck = { ok: true; room: string } | { ok: false; error: string };

const INVALID_PROPERTY_ID: RoomAck = { ok: false, error: 'propertyId must be a UUID' };
const NO_ACCESS: RoomAck = { ok: false, error: 'No access to this property' };
const UNKNOWN_PROPERTY: RoomAck = { ok: false, error: 'Unknown property' };

/** Handshake refusals, as the client sees them in connect_error. The reason is only logged. */
export const SOCKET_UNAUTHORIZED = 'unauthorized';
export const SOCKET_FORBIDDEN = 'forbidden';

/** setTimeout's limit (~24.8 days); tokens are far shorter, this only guards the arithmetic. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** The caller verified at the handshake, kept on the socket for its lifetime. */
export interface SocketData {
  auth?: AuthPrincipal;
}

/** The global ValidationPipe does not run for websockets, so validate by hand. */
function propertyIdFrom(body: unknown): string | null {
  const propertyId = (body as { propertyId?: unknown } | null | undefined)?.propertyId;
  return typeof propertyId === 'string' && isUUID(propertyId) ? propertyId : null;
}

/**
 * Kitchen display realtime channel (default namespace). Clients join one
 * property room and receive order.created / order.status_changed for it.
 *
 * Staff login (INTEGRATION_DESIGN.md §8.5): the handshake must carry an access token
 * in `auth.token` from a user with a POS role; joinProperty only for a property in the
 * token's property_ids. The server disconnects when the token expires; the client
 * reconnects with a renewed token, rejoins and refetches. With POS_AUTH_ENABLED=false
 * anyone can join any room, as before.
 */
@WebSocketGateway({ cors: { origin: allowOrigin } })
export class KitchenGateway implements OnGatewayInit {
  private readonly logger = new Logger(KitchenGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier | null,
    @Inject(PROPERTY_DIRECTORY) private readonly directory: PropertyDirectory,
  ) {}

  afterInit(server: Server): void {
    if (!this.config.enabled) return;
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (error: Error) => next(error),
      );
    });
  }

  /** Handshake check. Rejects with an Error whose message is all the client learns. */
  async authenticate(socket: Socket): Promise<void> {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || token === '') throw new Error(SOCKET_UNAUTHORIZED);

    let caller: AuthPrincipal;
    try {
      caller = await this.verifier!.verify(token);
    } catch (error) {
      if (!(error instanceof InvalidTokenError)) throw error;
      this.logger.warn(`Refused socket ${socket.id}: ${error.message}`);
      throw new Error(SOCKET_UNAUTHORIZED);
    }
    if (!caller.roles.some((role) => (POS_ROLES as readonly string[]).includes(role))) {
      this.logger.warn(`Refused socket ${socket.id} for ${caller.username}: no POS role`);
      throw new Error(SOCKET_FORBIDDEN);
    }

    (socket.data as SocketData).auth = caller;
    // Same allowance as the HTTP check, so a token the API still accepts isn't cut early.
    const msLeft = caller.expiresAt * 1000 + this.config.clockToleranceSeconds * 1000 - Date.now();
    const timer = setTimeout(() => {
      this.logger.debug(`Socket ${socket.id} (${caller.username}): token expired, disconnecting`);
      socket.disconnect(true);
    }, Math.min(Math.max(msLeft, 0), MAX_TIMER_MS));
    timer.unref();
    socket.once('disconnect', () => clearTimeout(timer));
  }

  @SubscribeMessage('joinProperty')
  async joinProperty(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<RoomAck> {
    const propertyId = propertyIdFrom(body);
    if (!propertyId) return INVALID_PROPERTY_ID;
    if (this.config.enabled) {
      const caller = (client.data as SocketData).auth;
      if (!caller?.propertyIds.includes(propertyId)) {
        this.logger.warn(`Socket ${client.id} (${caller?.username ?? 'unknown'}) refused room for property ${propertyId}`);
        return NO_ACCESS;
      }
    }
    // After the token check, as on HTTP: an unknown hotel is only reported to someone allowed to ask.
    if (!(await this.directory.find(propertyId))) return UNKNOWN_PROPERTY;
    const room = roomFor(propertyId);
    await client.join(room);
    this.logger.debug(`Socket ${client.id} joined ${room}`);
    return { ok: true, room };
  }

  @SubscribeMessage('leaveProperty')
  async leaveProperty(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<RoomAck> {
    const propertyId = propertyIdFrom(body);
    if (!propertyId) return INVALID_PROPERTY_ID;
    const room = roomFor(propertyId);
    await client.leave(room);
    this.logger.debug(`Socket ${client.id} left ${room}`);
    return { ok: true, room };
  }
}
