import { toMinor } from './money.js';
import type { MenuItem } from './types.js';

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 50;

export interface CartLine {
  menuItemId: string;
  name: string;
  /** Menu price when added, for display only. */
  unitPrice: string;
  currencyCode: string;
  quantity: number;
  note: string;
}

export interface CartState {
  lines: CartLine[];
}

export type CartAction =
  | { type: 'add'; item: Pick<MenuItem, 'id' | 'name' | 'price' | 'currencyCode'> }
  | { type: 'setQuantity'; menuItemId: string; quantity: number }
  | { type: 'setNote'; menuItemId: string; note: string }
  | { type: 'remove'; menuItemId: string }
  | { type: 'clear' }
  /** After a menu refetch: refresh names/prices and drop items no longer available. */
  | { type: 'syncMenu'; menu: MenuItem[] };

export const emptyCart: CartState = { lines: [] };

export function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return MIN_QUANTITY;
  return Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, Math.trunc(quantity)));
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const existing = state.lines.find((l) => l.menuItemId === action.item.id);
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l === existing ? { ...l, quantity: clampQuantity(l.quantity + 1) } : l,
          ),
        };
      }
      return {
        lines: [
          ...state.lines,
          {
            menuItemId: action.item.id,
            name: action.item.name,
            unitPrice: action.item.price,
            currencyCode: action.item.currencyCode,
            quantity: 1,
            note: '',
          },
        ],
      };
    }
    case 'setQuantity':
      return {
        lines: state.lines.map((l) =>
          l.menuItemId === action.menuItemId ? { ...l, quantity: clampQuantity(action.quantity) } : l,
        ),
      };
    case 'setNote':
      return {
        lines: state.lines.map((l) => (l.menuItemId === action.menuItemId ? { ...l, note: action.note } : l)),
      };
    case 'remove':
      return { lines: state.lines.filter((l) => l.menuItemId !== action.menuItemId) };
    case 'clear':
      return emptyCart;
    case 'syncMenu': {
      const byId = new Map(action.menu.map((m) => [m.id, m]));
      const lines: CartLine[] = [];
      for (const line of state.lines) {
        const item = byId.get(line.menuItemId);
        if (!item || !item.isAvailable) continue;
        lines.push({ ...line, name: item.name, unitPrice: item.price, currencyCode: item.currencyCode });
      }
      return { lines };
    }
  }
}

/** Lines that syncMenu would drop (gone or unavailable), for telling staff. */
export function unavailableLines(state: CartState, menu: MenuItem[]): CartLine[] {
  const available = new Set(menu.filter((m) => m.isAvailable).map((m) => m.id));
  return state.lines.filter((l) => !available.has(l.menuItemId));
}

export type CartSubtotal =
  | { kind: 'empty' }
  | { kind: 'ok'; minor: number; currencyCode: string }
  | { kind: 'mixed' };

/**
 * Subtotal in integer minor units, for display only. The server recalculates
 * the order from the menu and is the source of truth; we never send prices.
 */
export function cartSubtotal(state: CartState): CartSubtotal {
  if (state.lines.length === 0) return { kind: 'empty' };
  const currency = state.lines[0]!.currencyCode;
  let minor = 0;
  for (const line of state.lines) {
    if (line.currencyCode !== currency) return { kind: 'mixed' };
    minor += (toMinor(line.unitPrice) ?? 0) * line.quantity;
  }
  return { kind: 'ok', minor, currencyCode: currency };
}

export function cartItemCount(state: CartState): number {
  return state.lines.reduce((n, l) => n + l.quantity, 0);
}
