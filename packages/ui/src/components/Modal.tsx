// Adapted from HAIP apps/dashboard/src/components/ui/Modal.tsx (commit 928c2f6).
// Copyright 2026 Telivity. Licensed under the Apache License, Version 2.0; see ../../LICENSE.haip.
// Modified for StayX: i18n replaced by a closeLabel prop; ConfirmModal added.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button.js';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  closeDisabled?: boolean;
  closeLabel?: string;
}

export function Modal({ open, onClose, title, children, wide, closeDisabled = false, closeLabel = 'Close' }: ModalProps) {
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closeDisabledRef.current) {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        tabIndex={-1}
        aria-label={`${closeLabel} ${title}`}
        className="absolute inset-0 border-0 bg-black/40 p-0"
        disabled={closeDisabled}
        onClick={closeDisabled ? undefined : onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative mx-4 max-h-[85vh] w-full overflow-y-auto rounded-xl bg-white shadow-xl ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-telivity-navy">
            {title}
          </h2>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            disabled={closeDisabled}
            className="rounded-lg p-1 transition-colors hover:bg-telivity-light-grey disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={18} className="text-telivity-mid-grey" aria-hidden="true" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Large buttons for touch screens. */
  touch?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  touch = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const size = touch ? 'touch' : 'md';
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className={`text-telivity-slate ${touch ? 'text-lg' : 'text-sm'}`}>{children}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" size={size} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} size={size} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
