import { describe, it, expect } from 'vitest';
import { buildInboundCharge, calendarDateIn, classifyResponse, vendorTxnIdFor, type ChargeableOrder } from './charge-mapper.js';

const order: ChargeableOrder = {
  orderNumber: 'RS-261005-A1B2',
  roomNumber: '1204',
  subtotal: '34.75',
  currencyCode: 'USD',
  deliveredAt: new Date('2026-10-05T18:00:00Z'),
  updatedAt: new Date('2026-10-05T18:00:00Z'),
  items: [{}, {}],
};

describe('buildInboundCharge', () => {
  it('maps a delivered order to the HAIP body (pre-tax subtotal, no propertyId)', () => {
    expect(buildInboundCharge(order, 'stayx-rs-abc', 'America/New_York')).toEqual({
      roomNumber: '1204',
      type: 'food_beverage',
      amount: '34.75',
      currencyCode: 'USD',
      vendorTxnId: 'stayx-rs-abc',
      description: 'Room service RS-261005-A1B2 (2 item lines)',
      serviceDate: '2026-10-05',
    });
  });

  it('always formats the amount with 2 decimals', () => {
    expect(buildInboundCharge({ ...order, subtotal: '42' }, 'v', 'UTC').amount).toBe('42.00');
    expect(buildInboundCharge({ ...order, subtotal: '7.5' }, 'v', 'UTC').amount).toBe('7.50');
  });

  it('truncates the description to 255 characters', () => {
    const long = buildInboundCharge({ ...order, orderNumber: 'X'.repeat(400) }, 'v', 'UTC');
    expect(long.description).toHaveLength(255);
    expect(long.description.startsWith('Room service XXX')).toBe(true);
  });

  it('uses the calendar date in the property time zone, not UTC', () => {
    const lateNight = { ...order, deliveredAt: new Date('2026-10-06T02:30:00Z') };
    expect(buildInboundCharge(lateNight, 'v', 'America/New_York').serviceDate).toBe('2026-10-05');
    expect(buildInboundCharge(lateNight, 'v', 'UTC').serviceDate).toBe('2026-10-06');
    expect(buildInboundCharge(lateNight, 'v', 'Asia/Tokyo').serviceDate).toBe('2026-10-06');
  });

  it('falls back to updatedAt if deliveredAt is missing', () => {
    const noDelivery = { ...order, deliveredAt: null, updatedAt: new Date('2026-01-01T12:00:00Z') };
    expect(buildInboundCharge(noDelivery, 'v', 'UTC').serviceDate).toBe('2026-01-01');
  });
});

describe('helpers', () => {
  it('vendorTxnIdFor is deterministic', () => {
    expect(vendorTxnIdFor('abc')).toBe('stayx-rs-abc');
    expect(vendorTxnIdFor('abc')).toBe(vendorTxnIdFor('abc'));
  });

  it('calendarDateIn handles a DST boundary', () => {
    // 2026-11-01 05:30Z is 01:30 EDT/EST on the fall-back day in New York.
    expect(calendarDateIn(new Date('2026-11-01T05:30:00Z'), 'America/New_York')).toBe('2026-11-01');
  });
});

describe('classifyResponse', () => {
  it.each<[number | 'timeout' | 'network', string]>([
    [201, 'posted'],
    [200, 'posted'],
    [400, 'terminal'],
    [401, 'terminal'],
    [403, 'terminal'],
    [404, 'terminal'],
    [422, 'terminal'],
    [429, 'retry'],
    [408, 'retry'],
    [500, 'retry'],
    [502, 'retry'],
    [503, 'retry'],
    ['timeout', 'retry'],
    ['network', 'retry'],
  ])('%s → %s', (input, expected) => {
    expect(classifyResponse(input)).toBe(expected);
  });
});
