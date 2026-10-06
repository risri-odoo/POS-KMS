import { shortId } from '../kitchen.js';
import type { ConnectionState } from '../useKitchen.js';

interface Props {
  propertyId: string;
  connection: ConnectionState;
  soundEnabled: boolean;
  audioReady: boolean;
  onToggleSound: () => void;
}

const DOT: Record<ConnectionState, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-400 animate-pulse',
  disconnected: 'bg-red-500 animate-pulse',
};

const LABEL: Record<ConnectionState, string> = {
  connected: 'Live',
  connecting: 'Connecting',
  disconnected: 'Offline',
};

export function Header({ propertyId, connection, soundEnabled, audioReady, onToggleSound }: Props) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-900 px-4 py-2">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Kitchen</h1>
        <span className="font-mono text-lg text-neutral-400" title={propertyId}>
          {shortId(propertyId)}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span className="flex items-center gap-2 text-lg text-neutral-300" aria-live="polite">
          <span className={`inline-block h-4 w-4 rounded-full ${DOT[connection]}`} aria-hidden />
          {LABEL[connection]}
        </span>

        <button
          type="button"
          onClick={onToggleSound}
          aria-pressed={soundEnabled}
          className={`min-h-12 rounded-lg px-4 text-lg font-semibold ${
            soundEnabled ? 'bg-sky-600 text-white' : 'bg-neutral-800 text-neutral-300'
          }`}
        >
          {soundEnabled ? (audioReady ? 'Sound on' : 'Sound on (tap anywhere)') : 'Enable sound'}
        </button>
      </div>
    </header>
  );
}
