// Adapted from HAIP apps/dashboard/src/components/ui/StatusBadge.tsx (commit 928c2f6).
// Copyright 2026 Telivity. Licensed under the Apache License, Version 2.0; see ../../LICENSE.haip.
// Modified for StayX: i18n removed, tones split into badge-tones.ts, order statuses,
// high-contrast mode and a large size added.
import type { ReactNode } from 'react';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, toneClass, type BadgeTone, type OrderStatus } from '../badge-tones.js';

interface BadgeProps {
  tone?: BadgeTone;
  size?: 'md' | 'lg';
  highContrast?: boolean;
  className?: string;
  children: ReactNode;
}

const SIZE = {
  md: 'px-2.5 py-0.5 text-xs',
  lg: 'px-3.5 py-1 text-base',
} as const;

export function Badge({ tone = 'grey', size = 'md', highContrast = false, className = '', children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full font-semibold ${SIZE[size]} ${toneClass(tone, highContrast)} ${className}`}>
      {children}
    </span>
  );
}

interface OrderStatusBadgeProps {
  status: OrderStatus;
  size?: 'md' | 'lg';
  highContrast?: boolean;
  className?: string;
}

export function OrderStatusBadge({ status, ...rest }: OrderStatusBadgeProps) {
  return (
    <Badge tone={ORDER_STATUS_TONE[status]} {...rest}>
      {ORDER_STATUS_LABEL[status]}
    </Badge>
  );
}
