import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ApiError, fetchActiveBoard, getOrder, updateOrderStatus } from './api.js';
import { boardReducer, initialBoardState, needsFetch } from './board.js';
import { SOCKET_URL } from './config.js';
import type { Order, OrderStatus, OrderWithItems, RoomAck } from './types.js';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

interface Options {
  propertyId: string;
  /** Called for each live order.created (used for the beep). */
  onOrderCreated?: (order: OrderWithItems) => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns the socket, the board state and the HTTP calls for one property.
 *
 * On EVERY socket "connect" (first connect and each reconnect, since rooms are
 * lost on reconnect) it joins the property room and then refetches the board.
 */
export function useKitchen({ propertyId, onOrderCreated }: Options) {
  const [board, dispatch] = useReducer(boardReducer, initialBoardState);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [message, setMessage] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(new Set());

  // Latest values for socket handlers registered once per property.
  const boardRef = useRef(board);
  boardRef.current = board;
  const onCreatedRef = useRef(onOrderCreated);
  onCreatedRef.current = onOrderCreated;
  const refetchGeneration = useRef(0);

  const refetch = useCallback(async () => {
    const generation = ++refetchGeneration.current;
    const sinceSeq = boardRef.current.seq;
    try {
      const orders = await fetchActiveBoard(propertyId);
      // A newer refetch was started meanwhile; its result wins.
      if (generation !== refetchGeneration.current) return;
      dispatch({ type: 'replaceAll', orders, sinceSeq });
    } catch (error) {
      if (generation === refetchGeneration.current) setMessage(`Could not load orders: ${messageOf(error)}`);
    }
  }, [propertyId]);

  const loadOne = useCallback(
    async (id: string) => {
      try {
        dispatch({ type: 'upsert', order: await getOrder(propertyId, id) });
      } catch (error) {
        setMessage(`Could not load order: ${messageOf(error)}`);
      }
    },
    [propertyId],
  );

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    setConnection('connecting');

    socket.on('connect', async () => {
      setConnection('connected');
      try {
        const ack = (await socket.timeout(5000).emitWithAck('joinProperty', { propertyId })) as RoomAck;
        if (!ack.ok) {
          setMessage(`Could not join kitchen channel: ${ack.error ?? 'unknown error'}`);
          return;
        }
      } catch {
        setMessage('Kitchen channel did not respond; retrying on reconnect');
        return;
      }
      await refetch();
    });

    socket.on('disconnect', () => setConnection('disconnected'));
    socket.on('connect_error', () => setConnection('disconnected'));

    socket.on('order.created', (order: OrderWithItems) => {
      if (order?.propertyId !== propertyId) return;
      dispatch({ type: 'upsert', order });
      onCreatedRef.current?.(order);
    });

    socket.on('order.status_changed', (order: Order) => {
      if (order?.propertyId !== propertyId) return;
      if (needsFetch(boardRef.current, order)) {
        void loadOne(order.id); // missed the create: fetch it with items
      } else {
        dispatch({ type: 'statusChanged', order });
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [propertyId, refetch, loadOne]);

  const changeStatus = useCallback(
    async (id: string, status: OrderStatus) => {
      setInFlight((s) => new Set(s).add(id));
      try {
        const updated = await updateOrderStatus(propertyId, id, status);
        dispatch({ type: 'statusChanged', order: updated });
      } catch (error) {
        if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
          setMessage(
            error.status === 409
              ? 'Someone else just changed that order. Board refreshed.'
              : `Not allowed: ${error.message}. Board refreshed.`,
          );
          void refetch();
        } else {
          setMessage(`Update failed: ${messageOf(error)}`);
        }
      } finally {
        setInFlight((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }
    },
    [propertyId, refetch],
  );

  return {
    board,
    connection,
    message,
    dismissMessage: useCallback(() => setMessage(null), []),
    inFlight,
    changeStatus,
  };
}
