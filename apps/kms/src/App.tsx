import { useCallback, useEffect, useMemo, useState } from 'react';
import { Volume2, VolumeX, X } from 'lucide-react';
import { AppShell, Button, HeaderDate } from '@stayx/ui';
import { groupColumns } from './board.js';
import { resolvePropertyId } from './config.js';
import { Column } from './components/Column.js';
import { PropertyForm } from './components/PropertyForm.js';
import { shortId } from './kitchen.js';
import { beep, loadSoundPreference, saveSoundPreference, unlockAudio } from './sound.js';
import { ACTIVE_STATUSES, type OrderWithItems } from './types.js';
import { useKitchen } from './useKitchen.js';

const CLOCK_TICK_MS = 30_000;

export function App() {
  const propertyId = resolvePropertyId(window.location.search, import.meta.env.VITE_DEFAULT_PROPERTY_ID);
  if (!propertyId) {
    return <PropertyForm initial={new URLSearchParams(window.location.search).get('propertyId') ?? ''} />;
  }
  return <KitchenBoard propertyId={propertyId} />;
}

function KitchenBoard({ propertyId }: { propertyId: string }) {
  const [soundEnabled, setSoundEnabled] = useState(loadSoundPreference);
  const [audioReady, setAudioReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Ages on cards are recomputed from createdAt every 30s.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // A remembered "sound on" still needs a user gesture after reload before the
  // browser lets audio play: unlock on the first tap anywhere.
  useEffect(() => {
    if (!soundEnabled || audioReady) return;
    const unlock = () => void unlockAudio().then(setAudioReady);
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, [soundEnabled, audioReady]);

  const toggleSound = useCallback(async () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    saveSoundPreference(next);
    if (next) {
      const ready = await unlockAudio();
      setAudioReady(ready);
      if (ready) beep(); // confirms it works
    }
  }, [soundEnabled]);

  const onOrderCreated = useCallback(
    (_order: OrderWithItems) => {
      if (soundEnabled && audioReady) beep();
    },
    [soundEnabled, audioReady],
  );

  const { board, connection, message, dismissMessage, inFlight, changeStatus } = useKitchen({
    propertyId,
    onOrderCreated,
  });
  const columns = useMemo(() => groupColumns(board), [board]);

  return (
    <AppShell
      brand="StayX Kitchen"
      connection={connection}
      largeConnection
      fill
      mainClassName="p-3"
      headerStart={
        <>
          <span className="rounded-lg border border-gray-200 px-3 py-1.5 font-mono text-sm text-telivity-slate" title={propertyId}>
            {shortId(propertyId)}
          </span>
          <HeaderDate />
        </>
      }
      headerEnd={
        <Button
          variant={soundEnabled ? 'primary' : 'secondary'}
          highContrast
          icon={soundEnabled ? Volume2 : VolumeX}
          onClick={toggleSound}
          aria-pressed={soundEnabled}
          className="min-h-12 text-base!"
        >
          {soundEnabled ? (audioReady ? 'Sound on' : 'Sound on (tap anywhere)') : 'Enable sound'}
        </Button>
      }
      banner={
        <>
          {connection !== 'connected' && (
            <div role="alert" className="bg-telivity-orange px-4 py-2 text-center text-xl font-semibold text-telivity-navy">
              {connection === 'connecting' ? 'Connecting to kitchen server…' : 'Disconnected — reconnecting. Board may be out of date.'}
            </div>
          )}

          {message && (
            <div role="status" className="flex items-center justify-between gap-4 border-b border-telivity-orange bg-telivity-yellow/25 px-4 py-1 text-lg font-semibold text-telivity-navy">
              <span>{message}</span>
              <button
                type="button"
                onClick={dismissMessage}
                className="flex min-h-12 min-w-12 items-center justify-center rounded-lg hover:bg-black/5"
                aria-label="Dismiss message"
              >
                <X size={22} aria-hidden="true" />
              </button>
            </div>
          )}
        </>
      }
    >
      <div className="grid min-h-0 flex-1 grid-cols-[repeat(4,minmax(14.5rem,1fr))] grid-rows-[minmax(0,1fr)] gap-3 overflow-x-auto">
        {ACTIVE_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            orders={columns[status]}
            now={now}
            inFlight={inFlight}
            onChangeStatus={changeStatus}
          />
        ))}
      </div>
    </AppShell>
  );
}
