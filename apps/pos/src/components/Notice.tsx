export interface NoticeMessage {
  kind: 'success' | 'error';
  text: string;
}

export function Notice({ notice, onDismiss }: { notice: NoticeMessage | null; onDismiss: () => void }) {
  if (!notice) return null;
  const style = notice.kind === 'success' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-neutral-950';
  return (
    <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`flex items-center justify-between gap-4 px-4 py-1 text-lg font-semibold ${style}`}>
      <span>{notice.text}</span>
      <button type="button" onClick={onDismiss} className="min-h-12 min-w-12 rounded-lg px-3 font-bold" aria-label="Dismiss message">
        ✕
      </button>
    </div>
  );
}
