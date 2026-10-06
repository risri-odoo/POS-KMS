import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';
import { KitchenGateway, roomFor } from './kitchen.gateway.js';

const PROPERTY_A = '11111111-1111-4111-8111-111111111111';

function fakeSocket() {
  return {
    id: 'socket-1',
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
  };
}

describe('roomFor', () => {
  it('builds the property room name', () => {
    expect(roomFor(PROPERTY_A)).toBe(`property:${PROPERTY_A}`);
  });
});

describe('KitchenGateway', () => {
  let gateway: KitchenGateway;
  let socket: ReturnType<typeof fakeSocket>;

  beforeEach(() => {
    gateway = new KitchenGateway();
    socket = fakeSocket();
  });

  it('joins the property room for a valid UUID and acks ok', async () => {
    const ack = await gateway.joinProperty(socket as unknown as Socket, { propertyId: PROPERTY_A });

    expect(socket.join).toHaveBeenCalledExactlyOnceWith(`property:${PROPERTY_A}`);
    expect(ack).toEqual({ ok: true, room: `property:${PROPERTY_A}` });
  });

  it.each<[string, unknown]>([
    ['a non-UUID string', { propertyId: 'abc' }],
    ['a missing propertyId', {}],
    ['a non-string propertyId', { propertyId: 42 }],
    ['a null body', null],
    ['a bare string body', PROPERTY_A],
    ['a room-name injection attempt', { propertyId: `${PROPERTY_A},property:x` }],
  ])('rejects %s without joining', async (_label, body) => {
    const ack = await gateway.joinProperty(socket as unknown as Socket, body);

    expect(ack).toEqual({ ok: false, error: 'propertyId must be a UUID' });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('leaves the property room for a valid UUID and acks ok', async () => {
    const ack = await gateway.leaveProperty(socket as unknown as Socket, { propertyId: PROPERTY_A });

    expect(socket.leave).toHaveBeenCalledExactlyOnceWith(`property:${PROPERTY_A}`);
    expect(ack).toEqual({ ok: true, room: `property:${PROPERTY_A}` });
  });

  it('rejects leaveProperty with an invalid propertyId', async () => {
    const ack = await gateway.leaveProperty(socket as unknown as Socket, { propertyId: 'nope' });

    expect(ack).toEqual({ ok: false, error: 'propertyId must be a UUID' });
    expect(socket.leave).not.toHaveBeenCalled();
  });
});
