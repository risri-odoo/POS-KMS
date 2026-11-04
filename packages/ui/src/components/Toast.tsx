// Adapted from HAIP apps/dashboard/src/components/ui/Toast.tsx (commit 928c2f6).
// Copyright 2026 Telivity. Licensed under the Apache License, Version 2.0; see ../../LICENSE.haip.
// Modified for StayX: ToastView and ToastStack exported, and a sticky mode added so a
// message can stay until dismissed. Touch-friendly dismiss button.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

const DURATION_MS = 4000;

const ICONS = { success: CheckCircle, error: AlertTriangle, info: Info };

const STYLES = {
  success: 'border-telivity-dark-teal bg-telivity-dark-teal/5',
  error: 'border-telivity-orange bg-telivity-orange/5',
  info: 'border-telivity-deep-blue bg-telivity-deep-blue/5',
};

const ICON_COLORS = {
  success: 'text-telivity-dark-teal',
  error: 'text-telivity-orange',
  info: 'text-telivity-deep-blue',
};

const BAR_COLORS = {
  success: 'bg-telivity-dark-teal',
  error: 'bg-telivity-orange',
  info: 'bg-telivity-deep-blue',
};

export function ToastStack({ children }: { children: ReactNode }) {
  return (
    <div className="fixed right-4 bottom-4 z-[60] flex max-w-sm flex-col gap-2" role="log" aria-live="polite">
      {children}
    </div>
  );
}

interface ToastViewProps {
  type: ToastType;
  message: string;
  onDismiss: () => void;
  /** Stay on screen until dismissed, with no timer or progress bar. */
  sticky?: boolean;
}

export function ToastView({ type, message, onDismiss, sticky = false }: ToastViewProps) {
  const Icon = ICONS[type];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remainingRef = useRef(DURATION_MS);
  const startRef = useRef(Date.now());
  const onDismissRef = useRef(onDismiss);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const startTimer = useCallback(() => {
    if (sticky) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    startRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismissRef.current();
    }, remainingRef.current);
    progressIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const rem = Math.max(0, remainingRef.current - elapsed);
      setProgress((rem / DURATION_MS) * 100);
    }, 50);
  }, [sticky]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      const elapsed = Date.now() - startRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
      setProgress((remainingRef.current / DURATION_MS) * 100);
    }
  }, []);

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, [startTimer]);

  return (
    <div
      className={`relative flex animate-slide-in items-start gap-3 overflow-hidden rounded-xl border-l-4 bg-white px-4 py-3 shadow-lg ${STYLES[type]}`}
      role={type === 'error' ? 'alert' : 'status'}
      onMouseEnter={pauseTimer}
      onMouseLeave={startTimer}
    >
      <Icon size={18} className={`mt-0.5 flex-shrink-0 ${ICON_COLORS[type]}`} aria-hidden="true" />
      <p className="flex-1 text-sm text-telivity-navy">{message}</p>
      <button type="button" onClick={onDismiss} className="-m-1 rounded-sm p-1 hover:bg-black/5" aria-label="Dismiss message">
        <X size={14} className="text-telivity-mid-grey" aria-hidden="true" />
      </button>
      {!sticky && (
        <div
          className={`absolute bottom-0 left-0 h-1 transition-all duration-75 ease-linear ${BAR_COLORS[type]}`}
          style={{ width: `${progress}%` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((type: ToastType, message: string) => {
    const id = nextId++;
    setToasts((prev) => {
      if (prev.some((item) => item.type === type && item.message === message)) return prev;
      return [...prev, { id, type, message }].slice(-3);
    });
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastStack>
        {toasts.map((t) => (
          <ToastView key={t.id} type={t.type} message={t.message} onDismiss={() => dismiss(t.id)} />
        ))}
      </ToastStack>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
