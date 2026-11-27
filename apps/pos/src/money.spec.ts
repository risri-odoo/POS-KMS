import { describe, it, expect } from 'vitest';
import {
  formatMoney,
  minorToDecimal,
  normalizePrice,
  parsePrice,
  toMinor,
  validateMenuItemForm,
  validatePrice,
  type MenuItemForm,
} from './money.js';

describe('parsePrice', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['0.01', 1],
    [' 3.25 ', 325],
  ])('accepts %j → %i minor units', (input, minor) => {
    expect(parsePrice(input)).toBe(minor);
  });

  it.each(['1.234', '-1', '0', '0.00', 'abc', '', '1e3', '12.', '.5', '1,50', '12345678901'])('rejects %j', (input) => {
    expect(parsePrice(input)).toBeNull();
  });
});

describe('validatePrice', () => {
  it('explains the specific problem', () => {
    expect(validatePrice('')).toBe('Price is required');
    expect(validatePrice('1.234')).toBe('Use at most 2 decimal places');
    expect(validatePrice('0')).toBe('Enter a positive amount like 12.50');
    expect(validatePrice('12.50')).toBeNull();
  });
});

describe('minor-unit conversions', () => {
  it('converts server decimals exactly', () => {
    expect(toMinor('12.50')).toBe(1250);
    expect(toMinor('0.10')).toBe(10);
    expect(toMinor('-3.05')).toBe(-305);
    expect(toMinor('garbage')).toBeNull();
  });

  it('renders minor units back to 2-decimal strings', () => {
    expect(minorToDecimal(3475)).toBe('34.75');
    expect(minorToDecimal(5)).toBe('0.05');
    expect(normalizePrice('12.5')).toBe('12.50');
  });

  it('formats money with the currency, falling back for unknown codes', () => {
    expect(formatMoney(3475, 'USD')).toMatch(/34\.75/);
    expect(formatMoney(3475, 'ZZZ1')).toBe('34.75 ZZZ1');
  });
});

describe('validateMenuItemForm', () => {
  const valid: MenuItemForm = {
    name: 'Club Sandwich',
    category: 'Mains',
    description: '',
    price: '12.50',
    sortOrder: '',
  };

  it('accepts a valid form', () => {
    expect(validateMenuItemForm(valid)).toEqual({});
  });

  it('reports every invalid field', () => {
    const errors = validateMenuItemForm({
      name: '  ',
      category: 'x'.repeat(101),
      description: '',
      price: '1.234',
      sortOrder: '-1',
    });
    expect(Object.keys(errors).sort()).toEqual(['category', 'name', 'price', 'sortOrder']);
  });
});
