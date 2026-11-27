import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  SkeletonTable,
  Table,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@stayx/ui';
import { ApiError, listOutbox, messageOf, resolveOutbox, retryOutbox } from '../api.js';
import { formatPrice } from '../money.js';
import {
  CHARGE_ID_MAX,
  NOTE_MAX,
  OUTBOX_REFRESH_MS,
  REASON_LABEL,
  RESOLUTION_HINT,
  RESOLUTION_LABEL,
  RESOLUTION_TYPES,
  STATUS_LABEL,
  STATUS_TONE,
  canResolve,
  canRetry,
  emptyResolveForm,
  explain,
  mayAlreadyBePosted,
  resolveBody,
  retryBlockedReason,
  validateResolveForm,
  type ResolveForm,
  type ResolveFormErrors,
} from '../outbox.js';
import type { OutboxEntry, OutboxQuery, ParkedReason } from '../types.js';

interface Props {
  propertyId: string;
  notify: (kind: 'success' | 'error', text: string) => void;
}

const REASONS = Object.keys(REASON_LABEL) as ParkedReason[];
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—');
const orderLabel = (entry: OutboxEntry) => (entry.order ? `${entry.order.orderNumber}, room ${entry.order.roomNumber}` : `order ${entry.orderId.slice(0, 8)}`);

/**
 * Outbox/Errors (managers only, AUDIT.md item 13): HAIP folio charges that need a person.
 * Retry sends a charge again; Resolve closes it with a type and a note.
 */
export function OutboxPanel({ propertyId, notify }: Props) {
  const [query, setQuery] = useState<OutboxQuery>({ view: 'attention' });
  const [entries, setEntries] = useState<OutboxEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [retrying, setRetrying] = useState<OutboxEntry | null>(null);
  const [resolving, setResolving] = useState<OutboxEntry | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const gen = ++generation.current;
    setLoading(true);
    try {
      const rows = await listOutbox(propertyId, query);
      if (gen === generation.current) {
        setEntries(rows);
        setRefreshedAt(new Date());
      }
    } catch (error) {
      if (gen === generation.current) notify('error', `Could not load the outbox: ${messageOf(error)}`);
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, [propertyId, query, notify]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), OUTBOX_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const done = (text: string) => {
    notify('success', text);
    setRetrying(null);
    setResolving(null);
    void refresh();
  };
  /** 400/409: someone else changed it, or it is no longer actionable. Show why and reload. */
  const failed = (action: string, error: unknown) => {
    notify('error', `${action} failed: ${messageOf(error)}`);
    if (error instanceof ApiError && (error.status === 400 || error.status === 404 || error.status === 409)) {
      setRetrying(null);
      setResolving(null);
      void refresh();
    }
  };

  return (
    <>
      <PageHeader title="Outbox/Errors" icon={AlertTriangle} className="mb-3!" />
      {/* Filters on their own row, left: POS notices stay at the top right until dismissed. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show" className="flex overflow-hidden rounded-lg border border-gray-200">
          {(['attention', 'all'] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={(query.view ?? 'attention') === view}
              onClick={() => setQuery((q) => ({ ...q, view }))}
              className={`min-h-10 px-3 text-sm font-semibold ${(query.view ?? 'attention') === view ? 'bg-telivity-navy text-white' : 'bg-white text-telivity-navy hover:bg-gray-50'}`}
            >
              {view === 'attention' ? 'Needs attention' : 'All'}
            </button>
          ))}
        </div>
        <Select
          aria-label="Reason"
          value={query.parkedReason ?? ''}
          onChange={(e) => setQuery((q) => ({ ...q, parkedReason: (e.target.value || undefined) as ParkedReason | undefined }))}
          className="min-h-10 w-auto!"
        >
          <option value="">Any reason</option>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {REASON_LABEL[r]}
            </option>
          ))}
        </Select>
        <Button variant="secondary" icon={RefreshCw} loading={loading} onClick={() => void refresh()} className="min-h-10">
          Refresh
        </Button>
        <span className="text-xs text-telivity-slate" aria-live="polite">
          {refreshedAt ? `Updated ${refreshedAt.toLocaleTimeString([], { timeStyle: 'short' })}; refreshes every 30 seconds.` : 'Loading…'}
        </span>
      </div>

      {entries === null ? (
        <SkeletonTable cols={6} />
      ) : (
        <Table tableClassName="min-w-[56rem]">
          <TableHead>
            <TableHeader>Status</TableHeader>
            <TableHeader>Order</TableHeader>
            <TableHeader>Guest</TableHeader>
            <TableHeader align="right">Amount</TableHeader>
            <TableHeader>What happened</TableHeader>
            <TableHeader />
          </TableHead>
          <tbody>
            {entries.length === 0 && (
              <TableEmpty colSpan={6}>{(query.view ?? 'attention') === 'attention' ? 'Nothing needs attention.' : 'No charges yet.'}</TableEmpty>
            )}
            {entries.map((entry) => (
              <OutboxRow key={entry.id} entry={entry} onRetry={() => setRetrying(entry)} onResolve={() => setResolving(entry)} />
            ))}
          </tbody>
        </Table>
      )}

      {retrying && (
        <RetryDialog
          entry={retrying}
          onClose={() => setRetrying(null)}
          onSubmit={async (note) => {
            try {
              await retryOutbox(propertyId, retrying.id, note);
              done(`Sending ${orderLabel(retrying)} to HAIP again.`);
            } catch (error) {
              failed('Retry', error);
            }
          }}
        />
      )}
      {resolving && (
        <ResolveDialog
          entry={resolving}
          onClose={() => setResolving(null)}
          onSubmit={async (form) => {
            try {
              await resolveOutbox(propertyId, resolving.id, resolveBody(form));
              done(`${orderLabel(resolving)}: resolved as "${RESOLUTION_LABEL[form.resolutionType as keyof typeof RESOLUTION_LABEL]}".`);
            } catch (error) {
              failed('Resolve', error);
            }
          }}
        />
      )}
    </>
  );
}

function OutboxRow({ entry, onRetry, onResolve }: { entry: OutboxEntry; onRetry: () => void; onResolve: () => void }) {
  const blocked = retryBlockedReason(entry);
  return (
    <TableRow className="align-top">
      <TableCell>
        {/* A stuck charge is still pending, but it needs a look: orange, like needs attention. */}
        <Badge tone={entry.stuck ? 'orange' : STATUS_TONE[entry.status]}>{STATUS_LABEL[entry.status]}</Badge>
        {entry.parkedReason && <div className="mt-1 text-xs text-telivity-slate">{REASON_LABEL[entry.parkedReason]}</div>}
      </TableCell>
      <TableCell>
        {entry.order ? (
          <>
            <div className="font-mono text-sm text-telivity-navy">{entry.order.orderNumber}</div>
            <div className="text-sm">Room {entry.order.roomNumber}</div>
            <div className="text-xs text-telivity-slate">Delivered {time(entry.order.deliveredAt)}</div>
          </>
        ) : (
          <span className="text-sm text-telivity-slate">Order {entry.orderId.slice(0, 8)} (not found)</span>
        )}
      </TableCell>
      <TableCell>
        {entry.order?.guestName ? (
          <span>{entry.order.guestName}</span>
        ) : (
          <Badge tone="yellow">Unverified</Badge>
        )}
        {entry.order?.placedBy && <div className="mt-1 text-xs text-telivity-slate">Placed by {entry.order.placedBy}</div>}
      </TableCell>
      <TableCell align="right" strong>
        {entry.order ? formatPrice(entry.order.subtotal, entry.order.currencyCode) : '—'}
      </TableCell>
      <TableCell className="max-w-md">
        <p className="text-sm text-telivity-navy">{explain(entry)}</p>
        {entry.lastError && <p className="mt-1 text-xs break-words text-telivity-slate">Error: {entry.lastError}</p>}
        <p className="mt-1 text-xs text-telivity-slate">
          {entry.attempts} attempt{entry.attempts === 1 ? '' : 's'}
          {entry.lastRetryAt && ` · retried ${time(entry.lastRetryAt)}${entry.lastRetryBy ? ` by ${entry.lastRetryBy}` : ''}`}
        </p>
        {entry.resolutionType && (
          <p className="mt-1 text-xs text-telivity-navy">
            <strong>{RESOLUTION_LABEL[entry.resolutionType]}</strong>
            {entry.resolvedBy && ` by ${entry.resolvedBy}`} {time(entry.resolvedAt)}
            {entry.resolutionNote && <span className="block text-telivity-slate">“{entry.resolutionNote}”</span>}
            {entry.haipChargeId && <span className="block font-mono text-telivity-slate">HAIP charge {entry.haipChargeId}</span>}
          </p>
        )}
      </TableCell>
      <TableCell>
        {(canRetry(entry) || canResolve(entry)) && (
          <div className="flex flex-col items-stretch gap-2">
            <Button variant="secondary" size="sm" disabled={!canRetry(entry)} onClick={onRetry} title={blocked ?? undefined}>
              Retry
            </Button>
            {blocked && canResolve(entry) && <span className="max-w-48 text-xs text-telivity-slate">{blocked}</span>}
            <Button size="sm" disabled={!canResolve(entry)} onClick={onResolve}>
              Resolve
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function FolioWarning() {
  return (
    <p role="alert" className="rounded-lg border border-telivity-orange bg-telivity-orange/10 p-3 text-sm text-telivity-navy">
      <strong>Check the guest folio in HAIP first.</strong> HAIP may have received this charge even though the answer was lost, so it
      could already be posted.
    </p>
  );
}

function RetryDialog({ entry, onClose, onSubmit }: { entry: OutboxEntry; onClose: () => void; onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSubmit(note);
    setSaving(false);
  };
  return (
    <Modal open onClose={onClose} title={`Send ${orderLabel(entry)} again?`} closeDisabled={saving}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        {mayAlreadyBePosted(entry) && <FolioWarning />}
        <p className="text-sm text-telivity-slate">It is sent with the same charge id, so HAIP won't post it twice.</p>
        <Field label="Note (optional)" hint="Why it is being sent again, e.g. what was fixed.">
          {(id) => <Textarea id={id} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} rows={3} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Send again
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResolveDialog({ entry, onClose, onSubmit }: { entry: OutboxEntry; onClose: () => void; onSubmit: (form: ResolveForm) => Promise<void> }) {
  const [form, setForm] = useState<ResolveForm>(emptyResolveForm);
  const [errors, setErrors] = useState<ResolveFormErrors>({});
  const [saving, setSaving] = useState(false);
  /** Change one field and drop its old error, so a fixed field doesn't keep complaining. */
  const update = <K extends keyof ResolveForm>(key: K, value: ResolveForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors(({ [key]: _old, ...rest }) => rest);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateResolveForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    await onSubmit(form);
    setSaving(false);
  };
  return (
    <Modal open onClose={onClose} title={`Resolve ${orderLabel(entry)}`} closeDisabled={saving} wide>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
        {mayAlreadyBePosted(entry) && <FolioWarning />}
        <fieldset aria-describedby={errors.resolutionType ? 'resolution-type-error' : undefined}>
          <legend className="mb-2 text-sm font-semibold text-telivity-navy">How was it resolved? *</legend>
          <div className="flex flex-col gap-2" role="radiogroup">
            {RESOLUTION_TYPES.map((type) => (
              <label
                key={type}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${form.resolutionType === type ? 'border-telivity-teal bg-telivity-teal/5' : 'border-gray-200'}`}
              >
                <input
                  type="radio"
                  name="resolutionType"
                  value={type}
                  checked={form.resolutionType === type}
                  onChange={() => update('resolutionType', type)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-telivity-navy">{RESOLUTION_LABEL[type]}</span>
                  <span className="block text-xs text-telivity-slate">{RESOLUTION_HINT[type]}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.resolutionType && (
            <p id="resolution-type-error" className="mt-1 text-sm text-red-600">
              {errors.resolutionType}
            </p>
          )}
        </fieldset>
        {form.resolutionType === 'posted_manually' && (
          <Field label="HAIP charge id (optional)" error={errors.haipChargeId} hint="From the guest folio in HAIP, if you have it.">
            {(id) => (
              <Input
                id={id}
                value={form.haipChargeId}
                maxLength={CHARGE_ID_MAX}
                onChange={(e) => update('haipChargeId', e.target.value)}
                autoComplete="off"
                className="font-mono"
              />
            )}
          </Field>
        )}
        <Field label="Note *" error={errors.note} hint="What was done and why. Kept with the charge.">
          {(id) => (
            <Textarea
              id={id}
              value={form.note}
              maxLength={NOTE_MAX}
              onChange={(e) => update('note', e.target.value)}
              rows={3}
              invalid={Boolean(errors.note)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Resolve
          </Button>
        </div>
      </form>
    </Modal>
  );
}
