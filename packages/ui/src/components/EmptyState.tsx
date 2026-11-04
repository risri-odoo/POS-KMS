import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function EmptyState({ icon: Icon, action, className = '', children }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-telivity-mid-grey ${className}`}>
      {Icon && <Icon size={24} aria-hidden="true" />}
      <p>{children}</p>
      {action}
    </div>
  );
}
