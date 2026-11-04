import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, icon: Icon, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`mb-6 flex flex-wrap items-center gap-3 ${className}`}>
      {Icon && <Icon size={24} className="text-telivity-teal" aria-hidden="true" />}
      <h1 className="text-2xl font-semibold text-telivity-navy">{title}</h1>
      {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
