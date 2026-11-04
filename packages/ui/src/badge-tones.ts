export type BadgeTone = 'teal' | 'dark-teal' | 'deep-blue' | 'orange' | 'yellow' | 'purple' | 'grey';

export type OrderStatus = 'placed' | 'accepted' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

/** Same pairs as HAIP's StatusBadge. Yellow carries navy text there too. */
const TONE_CLASS: Record<BadgeTone, string> = {
  teal: 'bg-telivity-teal text-white',
  'dark-teal': 'bg-telivity-dark-teal text-white',
  'deep-blue': 'bg-telivity-deep-blue text-white',
  orange: 'bg-telivity-orange text-white',
  yellow: 'bg-telivity-yellow text-telivity-navy',
  purple: 'bg-telivity-purple text-white',
  grey: 'bg-telivity-mid-grey text-white',
};

/** Kitchen screens: white on these backgrounds is too faint to read at a distance. */
const HIGH_CONTRAST_CLASS: Partial<Record<BadgeTone, string>> = {
  teal: 'bg-telivity-teal text-telivity-navy',
  orange: 'bg-telivity-orange text-telivity-navy',
};

export function toneClass(tone: BadgeTone, highContrast = false): string {
  return (highContrast ? HIGH_CONTRAST_CLASS[tone] : undefined) ?? TONE_CLASS[tone];
}

/**
 * Colour meaning follows HAIP's nearest status: placed = pending,
 * accepted = assigned, preparing = in_progress, delivered = completed,
 * cancelled = cancelled. Ready is yellow so it stands out for pickup.
 */
export const ORDER_STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  placed: 'orange',
  accepted: 'deep-blue',
  preparing: 'teal',
  ready: 'yellow',
  delivered: 'dark-teal',
  cancelled: 'grey',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'Placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
