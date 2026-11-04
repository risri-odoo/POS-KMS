import type { HTMLAttributes, ReactNode } from 'react';

const PADDING = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-6' } as const;

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: keyof typeof PADDING;
}

export function Card({ padding = 'md', className = '', children, ...rest }: CardProps) {
  return (
    <div className={`rounded-xl bg-white shadow-sm ${PADDING[padding]} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ className = '', children }: { className?: string; children: ReactNode }) {
  return <h2 className={`mb-4 text-sm font-semibold text-telivity-navy ${className}`}>{children}</h2>;
}
