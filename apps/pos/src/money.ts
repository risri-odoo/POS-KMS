/**
 * Money helpers. All arithmetic is done in integer minor units (cents) so
 * "12.50" × 3 is exactly 3750, never 37.499999.
 */

/** Same rule as the API's IsMoneyString: positive, max 10 integer digits, max 2 decimals. */
const PRICE_RE = /^\d{1,10}(\.\d{1,2})?$/;

/** A decimal string from the server (e.g. "12.50", "-3.00") → minor units, or null. */
export function toMinor(value: string): number | null {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  const minor = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(minor)) return null;
  return m[1] === '-' ? -minor : minor;
}

/** A price typed by staff → minor units, or null when it isn't a valid positive price. */
export function parsePrice(input: string): number | null {
  const value = input.trim();
  if (!PRICE_RE.test(value)) return null;
  const minor = toMinor(value);
  return minor !== null && minor > 0 ? minor : null;
}

/** Error message for a typed price, or null when valid. */
export function validatePrice(input: string): string | null {
  const value = input.trim();
  if (value === '') return 'Price is required';
  if (/^\d+\.\d{3,}$/.test(value)) return 'Use at most 2 decimal places';
  if (parsePrice(value) === null) return 'Enter a positive amount like 12.50';
  return null;
}

/** Normalise a valid typed price to the API's 2-decimal string ("12.5" → "12.50"). */
export function normalizePrice(input: string): string {
  const minor = parsePrice(input);
  if (minor === null) throw new Error(`Invalid price: ${input}`);
  return minorToDecimal(minor);
}

export function minorToDecimal(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Display a minor-unit amount, e.g. formatMoney(3475, 'USD') → "$34.75". */
export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
  } catch {
    // Unknown currency code: plain fallback rather than throwing in render.
    return `${minorToDecimal(minor)} ${currency}`;
  }
}

/** Display a server decimal string; falls back to the raw text if unparsable. */
export function formatPrice(value: string, currency: string): string {
  const minor = toMinor(value);
  return minor === null ? `${value} ${currency}` : formatMoney(minor, currency);
}

export interface MenuItemForm {
  name: string;
  category: string;
  description: string;
  price: string;
  currencyCode: string;
  sortOrder: string;
}

export type MenuItemFormErrors = Partial<Record<keyof MenuItemForm, string>>;

/** Client-side validation mirroring CreateMenuItemDto. Empty object = valid. */
export function validateMenuItemForm(form: MenuItemForm): MenuItemFormErrors {
  const errors: MenuItemFormErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = 'Name is required';
  else if (name.length > 255) errors.name = 'Name must be 255 characters or fewer';

  if (form.category.trim().length > 100) errors.category = 'Category must be 100 characters or fewer';

  const priceError = validatePrice(form.price);
  if (priceError) errors.price = priceError;

  if (!/^[A-Za-z]{3}$/.test(form.currencyCode.trim())) errors.currencyCode = 'Use a 3-letter code like USD';

  const sort = form.sortOrder.trim();
  if (sort !== '' && !/^\d{1,6}$/.test(sort)) errors.sortOrder = 'Sort order must be a whole number ≥ 0';

  return errors;
}
