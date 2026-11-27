import { useCallback, useEffect, useRef, useState } from 'react';
import { getOutboxSummary } from './api.js';
import { ALERT_REFRESH_MS, addedSince, attentionNotice, initialAlertState, type AlertState } from './outbox-alerts.js';
import type { ConnectionState } from './useOrdersFeed.js';

/**
 * Managers only: the count of charges needing attention, and whether HAIP posting is on.
 * Fetched on start, every minute and after each reconnect; updated live by the
 * outbox.attention_changed event (pass onAttentionChanged to the socket).
 */
export function useOutboxAlerts(
  propertyId: string,
  enabled: boolean,
  connection: ConnectionState,
  notifyAttention: (text: string) => void,
) {
  const [state, setState] = useState<AlertState>(initialAlertState);
  const countRef = useRef<number | null>(null);
  const notifyRef = useRef(notifyAttention);
  notifyRef.current = notifyAttention;
  const bridgeRef = useRef<boolean | null>(null);

  const apply = useCallback((count: number, bridgeEnabled: boolean | null) => {
    const bridge = bridgeEnabled ?? bridgeRef.current;
    bridgeRef.current = bridge;
    const added = addedSince(countRef.current, count);
    countRef.current = count;
    setState({ count, bridgeEnabled: bridge });
    if (added > 0 && bridge !== false) notifyRef.current(attentionNotice(added));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const summary = await getOutboxSummary(propertyId);
      apply(summary.total, summary.bridgeEnabled);
    } catch {
      // Keep what we have; the next refresh or event will correct it.
    }
  }, [propertyId, apply]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => void refresh(), ALERT_REFRESH_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  // After a reconnect, events may have been missed: ask again.
  useEffect(() => {
    if (enabled && connection === 'connected') void refresh();
  }, [enabled, connection, refresh]);

  /** For the socket: the event's count for this hotel. Ignored for non-managers. */
  const onAttentionChanged = useCallback(
    (event: { propertyId?: string; count?: number }) => {
      if (!enabled || event?.propertyId !== propertyId || typeof event.count !== 'number') return;
      apply(event.count, null);
    },
    [enabled, propertyId, apply],
  );

  return { alerts: enabled ? state : initialAlertState, onAttentionChanged, refreshAlerts: refresh };
}
