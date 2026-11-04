import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Spinner } from './Spinner.js';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'touch';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  loading?: boolean;
  /** Kitchen screens: navy text on the teal primary button. */
  highContrast?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary: 'bg-telivity-teal text-white hover:bg-telivity-light-teal',
  secondary: 'border border-gray-200 bg-white text-telivity-slate hover:bg-telivity-light-grey',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-telivity-slate hover:bg-telivity-light-grey',
};

const SIZE: Record<Size, string> = {
  sm: 'gap-1.5 px-3 py-1.5 text-xs',
  md: 'gap-2 px-4 py-2 text-sm',
  touch: 'min-h-14 gap-2 px-5 text-lg',
};

const ICON_SIZE: Record<Size, number> = { sm: 14, md: 16, touch: 22 };

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  highContrast = false,
  type = 'button',
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const contrast = highContrast && variant === 'primary' ? 'text-telivity-navy!' : '';
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-telivity-teal disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${contrast} ${className}`}
      {...rest}
    >
      {loading ? <Spinner size={ICON_SIZE[size]} /> : Icon ? <Icon size={ICON_SIZE[size]} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
