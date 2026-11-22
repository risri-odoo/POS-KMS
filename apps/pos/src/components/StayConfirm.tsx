import { AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { Button, Spinner } from '@stayx/ui';
import type { StayConfirmState } from '../stay-confirm.js';

interface Props {
  state: StayConfirmState;
  onSelectGuest: (reservationId: string, displayName: string) => void;
  onToggleUnverified: (confirmed: boolean) => void;
  onRetry: () => void;
}

/** Shows the room lookup result under the room number: pick a guest, or confirm an unverified order. */
export function StayConfirm({ state, onSelectGuest, onToggleUnverified, onRetry }: Props) {
  const { room, phase, selected, message } = state;
  if (room === '') return null;

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {message && (
        <p role="alert" className="rounded-lg border-l-4 border-telivity-orange bg-telivity-orange/10 px-3 py-2 text-sm text-telivity-navy">
          {message}
        </p>
      )}

      {phase.kind === 'idle' && !message && <p className="text-xs text-gray-500">Tap Find guest to confirm who is ordering.</p>}

      {phase.kind === 'loading' && (
        <p className="flex items-center gap-2 text-sm text-telivity-slate">
          <Spinner /> Looking up room {room}…
        </p>
      )}

      {phase.kind === 'found' && (
        <div className="flex flex-col gap-2" role="radiogroup" aria-label={`Guests in room ${room}`}>
          <p className="text-xs font-medium text-telivity-slate">Ask the guest their name, then tap it:</p>
          {phase.stays.map((stay, index) => (
            <div key={stay.reservationId} className="flex flex-col gap-1.5">
              {phase.stays.length > 1 && (
                <p className="text-[11px] font-semibold tracking-wide text-telivity-slate uppercase">
                  Stay {index + 1} · until {stay.departureDate}
                </p>
              )}
              {stay.guests.map((guest) => {
                const isSelected = selected?.reservationId === stay.reservationId && selected.displayName === guest.displayName;
                return (
                  <button
                    key={guest.displayName}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => onSelectGuest(stay.reservationId, guest.displayName)}
                    className={`flex min-h-11 items-center justify-between rounded-lg border px-3 text-left text-sm font-semibold transition-colors ${
                      isSelected
                        ? 'border-telivity-teal bg-telivity-teal/10 text-telivity-navy'
                        : 'border-gray-200 bg-white text-telivity-navy hover:border-telivity-teal'
                    }`}
                  >
                    {guest.displayName}
                    {isSelected && <Check size={18} className="text-telivity-dark-teal" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {phase.kind === 'none' && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border-l-4 border-telivity-orange bg-telivity-orange/10 px-3 py-2">
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-telivity-orange" aria-hidden="true" />
          <div className="text-sm text-telivity-navy">
            <p className="font-semibold">No guest checked in to room {room}.</p>
            <p className="text-xs text-telivity-slate">Check the room number. Orders can’t be placed for an empty room.</p>
          </div>
        </div>
      )}

      {(phase.kind === 'unavailable' || phase.kind === 'not_configured') && (
        <div className="flex flex-col gap-2 rounded-lg border-2 border-telivity-orange bg-telivity-orange/10 px-3 py-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-telivity-navy">
            <AlertTriangle size={18} className="text-telivity-orange" aria-hidden="true" />
            Unverified order
          </p>
          <p className="text-xs text-telivity-navy">
            {phase.kind === 'unavailable'
              ? `HAIP can’t be reached, so the guest in room ${room} can’t be confirmed.`
              : `Guest lookup isn’t set up, so the guest in room ${room} can’t be confirmed.`}{' '}
            The charge only posts if HAIP later shows exactly one guest in this room. Otherwise it waits for a manager.
          </p>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-telivity-navy">
            <input
              type="checkbox"
              checked={state.unverifiedConfirmed}
              onChange={(e) => onToggleUnverified(e.target.checked)}
              className="h-5 w-5 accent-telivity-orange"
            />
            I’ve confirmed the guest in room {room} in person
          </label>
        </div>
      )}

      {phase.kind === 'error' && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border-l-4 border-red-600 bg-red-50 px-3 py-2">
          <p className="text-sm text-telivity-navy">Couldn’t look up room {room}: {phase.message}</p>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
