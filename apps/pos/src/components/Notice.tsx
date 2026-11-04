import { ToastStack, ToastView } from '@stayx/ui';

export interface NoticeMessage {
  kind: 'success' | 'error';
  text: string;
}

/** Stays until dismissed or replaced. Top right, so it can't cover Place order. */
export function Notice({ notice, onDismiss }: { notice: NoticeMessage | null; onDismiss: () => void }) {
  if (!notice) return null;
  return (
    <ToastStack position="top">
      <ToastView key={notice.text} type={notice.kind} message={notice.text} sticky onDismiss={onDismiss} />
    </ToastStack>
  );
}
