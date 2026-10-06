import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import type { Server, Socket } from 'socket.io';
import { getAllowedOrigins } from '../common/cors.js';

/** The Socket.IO room for one property. The only place the room name is built. */
export function roomFor(propertyId: string): string {
  return `property:${propertyId}`;
}

export type RoomAck = { ok: true; room: string } | { ok: false; error: string };

const INVALID_PROPERTY_ID: RoomAck = { ok: false, error: 'propertyId must be a UUID' };

/** The global ValidationPipe does not run for websockets, so validate by hand. */
function propertyIdFrom(body: unknown): string | null {
  const propertyId = (body as { propertyId?: unknown } | null | undefined)?.propertyId;
  return typeof propertyId === 'string' && isUUID(propertyId) ? propertyId : null;
}

/**
 * Kitchen display realtime channel (default namespace). Clients join one
 * property room and receive order.created / order.status_changed for it.
 *
 * No auth yet: any client can join any property room. Phase 6: authenticate the handshake.
 */
@WebSocketGateway({ cors: { origin: getAllowedOrigins() } })
export class KitchenGateway {
  private readonly logger = new Logger(KitchenGateway.name);

  @WebSocketServer()
  server!: Server;

  @SubscribeMessage('joinProperty')
  async joinProperty(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<RoomAck> {
    const propertyId = propertyIdFrom(body);
    if (!propertyId) return INVALID_PROPERTY_ID;
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
