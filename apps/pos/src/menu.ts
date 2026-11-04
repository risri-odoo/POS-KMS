import type { MenuItem } from './types.js';

export const OTHER_CATEGORY = 'Other';

/** Same order as GET /menu-items: category, sortOrder, name. */
export function sortMenu(menu: MenuItem[]): MenuItem[] {
  return [...menu].sort(
    (a, b) =>
      (a.category ?? '').localeCompare(b.category ?? '') ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name),
  );
}

export interface MenuGroup {
  category: string;
  items: MenuItem[];
}

/** Available items grouped by category; uncategorised items go under "Other", listed last. */
export function groupAvailableMenu(menu: MenuItem[]): MenuGroup[] {
  const groups = new Map<string, MenuItem[]>();
  for (const item of sortMenu(menu)) {
    if (!item.isAvailable) continue;
    const category = item.category?.trim() || OTHER_CATEGORY;
    groups.set(category, [...(groups.get(category) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === OTHER_CATEGORY ? 1 : b === OTHER_CATEGORY ? -1 : a.localeCompare(b)))
    .map(([category, items]) => ({ category, items }));
}

/** "just now", "7 min", "2 h 5 min" since an ISO timestamp (never negative). */
export function formatAge(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const minutes = Math.max(0, Math.floor((now - t) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d`;
}
