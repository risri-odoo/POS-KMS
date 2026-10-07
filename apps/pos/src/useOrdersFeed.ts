import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { listOrders, messageOf } from './api.js';
import { SOCKET_URL } from './config.js';
import { feedReducer, initialFeedState, recentOrders } from './orders-feed.js';
import type { Order, OrderWithItems, RoomAck } from './types.js';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

/**
 * Live recent-orders feed for one property. On EVERY socket "connect" (rooms
 * are lost on reconnect) it joins the property room, waits for the ack, then
 * refetches, so no event is missed between the fetch and the join.
 */
export function useOrdersFeed(propertyId: string, onError: (message: string) => void) {
  const [feed, dispatch] = useReducer(feedReducer, initialFeedState);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  const feedRef = useRef(feed);
  feedRef.current = feed;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const generation = useRef(0);

  const refetch = useCallback(async () => {
    const gen = ++generation.current;
    const sinceSeq = feedRef.current.seq;
    try {
      const orders = await listOrders(propertyId);
      if (gen === generation.current) dispatch({ type: 'replaceAll', orders, sinceSeq });
    } catch (error) {
      if (gen === generation.current) onErrorRef.current(`Could not load recent orders: ${messageOf(error)}`);
    }
  }, [propertyId]);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    setConnection('connecting');

    socket.on('connect', async () => {
      setConnection('connected');
      try {
        const ack = (await socket.timeout(5000).emitWithAck('joinProperty', { propertyId })) as RoomAck;
        if (!ack?.ok) {
          onErrorRef.current(`Live updates unavailable: ${ack?.error ?? 'could not join'}`);
          return;
        }
      } catch {
        onErrorRef.current('Live updates did not respond; retrying on reconnect.');
        return;
      }
      await refetch();
    });
    socket.on('disconnect', () => setConnection('disconnected'));
    socket.on('connect_error', () => setConnection('disconnected'));

    socket.on('order.created', (order: OrderWithItems) => {
      if (order?.propertyId === propertyId) dispatch({ type: 'upsert', order });
    });
    socket.on('order.status_changed', (order: Order) => {
      if (order?.propertyId === propertyId) dispatch({ type: 'statusChanged', order });
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [propertyId, refetch]);

  /** Show an order we just placed right away (the socket echo is merged by id). */
  const addPlaced = useCallback((order: OrderWithItems) => dispatch({ type: 'upsert', order }), []);

  const orders = useMemo(() => recentOrders(feed), [feed]);
  return { orders, connection, addPlaced };
}
