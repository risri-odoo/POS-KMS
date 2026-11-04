import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const CONTROL =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-telivity-navy focus:border-telivity-teal focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500';

const INVALID = 'border-red-500 focus:border-red-500';

interface ControlProps {
  invalid?: boolean;
}

export function Input({ invalid = false, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & ControlProps) {
  return <input aria-invalid={invalid || undefined} className={`${CONTROL} ${invalid ? INVALID : ''} ${className}`} {...rest} />;
}

export function Select({ invalid = false, className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & ControlProps) {
  return (
    <select aria-invalid={invalid || undefined} className={`${CONTROL} ${invalid ? INVALID : ''} ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ invalid = false, className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & ControlProps) {
  return <textarea aria-invalid={invalid || undefined} className={`${CONTROL} ${invalid ? INVALID : ''} ${className}`} {...rest} />;
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  /** Receives the id to put on the control, so the label stays linked to it. */
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, error, className = '', children }: FieldProps) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-telivity-slate">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}
