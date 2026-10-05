import { randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from 'decimal.js';

/** The menu fields pricing needs (a subset of the menu_items row). */
export interface PricedMenuItem {
  id: string;
  name: string;
  price: string;
  currencyCode: string;
  isAvailable: boolean;
}

export interface OrderItemInput {
  menuItemId: string;
  quantity: number;
  notes?: string;
}

export interface PricedLine {
  menuItemId: string;
  name: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  notes: string | null;
}

export interface PricedOrder {
  lines: PricedLine[];
  subtotal: string;
  currencyCode: string;
}

/**
 * Price an order server-side from the menu. Client-supplied prices are never
 * accepted — the DTO has no price field. Money math is decimal.js on strings.
 */
export function priceOrder(menuMap: ReadonlyMap<string, PricedMenuItem>, items: readonly OrderItemInput[]): PricedOrder {
  if (items.length === 0) {
    throw new BadRequestException('An order must contain at least one item');
  }

  let currencyCode: string | undefined;
  let subtotal = new Decimal(0);
  const lines: PricedLine[] = [];

  for (const item of items) {
    const menuItem = menuMap.get(item.menuItemId);
    if (!menuItem) {
      throw new BadRequestException(`Menu item ${item.menuItemId} not found`);
    }
    if (!menuItem.isAvailable) {
      throw new BadRequestException(`Menu item "${menuItem.name}" is not available`);
    }
    if (currencyCode === undefined) {
      currencyCode = menuItem.currencyCode;
    } else if (menuItem.currencyCode !== currencyCode) {
      throw new BadRequestException(
        `Mixed currencies in one order (${currencyCode} and ${menuItem.currencyCode})`,
      );
    }

    const unitPrice = new Decimal(menuItem.price);
    const lineTotal = unitPrice.times(item.quantity);
    subtotal = subtotal.plus(lineTotal);

    lines.push({
      menuItemId: menuItem.id,
      name: menuItem.name,
      unitPrice: unitPrice.toFixed(2),
      quantity: item.quantity,
      lineTotal: lineTotal.toFixed(2),
      notes: item.notes ?? null,
    });
  }

  return { lines, subtotal: subtotal.toFixed(2), currencyCode: currencyCode! };
}

const ORDER_NUMBER_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O (look like 1/0)

/** Human-friendly order number, e.g. `RS-261005-A1B2` (UTC date + 4 random chars). */
export function generateOrderNumber(now: Date = new Date()): string {
  const yy = String(now.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const suffix = Array.from(randomBytes(4), (b) => ORDER_NUMBER_ALPHABET[b % ORDER_NUMBER_ALPHABET.length]).join('');
  return `RS-${yy}${mm}${dd}-${suffix}`;
}
