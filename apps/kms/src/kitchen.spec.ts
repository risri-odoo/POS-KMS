import { describe, it, expect } from 'vitest';
import { PRIMARY_ACTION, ageTone, canCancel, minutesSince, shortId } from './kitchen.js';
import { isUuid, propertyIdFromSearch } from './config.js';

describe('kitchen helpers', () => {
  const created = '2026-10-06T10:00:00.000Z';
  const at = (min: number) => Date.parse(created) + min * 60_000;

  it('computes whole minutes since placed, never negative', () => {
    expect(minutesSince(created, at(0))).toBe(0);
    expect(minutesSince(created, at(9.9))).toBe(9);
    expect(minutesSince(created, at(25))).toBe(25);
    expect(minutesSince(created, at(-3))).toBe(0);
    expect(minutesSince('garbage', at(5))).toBe(0);
  });

  it('turns amber from 10 minutes and red from 20', () => {
    expect(ageTone(9)).toBe('normal');
    expect(ageTone(10)).toBe('amber');
    expect(ageTone(19)).toBe('amber');
    expect(ageTone(20)).toBe('red');
  });

  it('has one primary action per column that moves the order forward', () => {
    expect(PRIMARY_ACTION.placed).toEqual({ label: 'Accept', to: 'accepted' });
    expect(PRIMARY_ACTION.accepted.to).toBe('preparing');
    expect(PRIMARY_ACTION.preparing.to).toBe('ready');
    expect(PRIMARY_ACTION.ready).toEqual({ label: 'Mark delivered', to: 'delivered' });
  });

  it('only allows cancel before ready', () => {
    expect(canCancel('placed')).toBe(true);
    expect(canCancel('accepted')).toBe(true);
    expect(canCancel('preparing')).toBe(true);
    expect(canCancel('ready')).toBe(false);
  });

  it('shortens ids and validates propertyId from the URL', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(shortId(id)).toBe('11111111');
    expect(isUuid(id)).toBe(true);
    expect(propertyIdFromSearch(`?propertyId=${id}`)).toBe(id);
    expect(propertyIdFromSearch('?propertyId=nope')).toBeNull();
    expect(propertyIdFromSearch('')).toBeNull();
  });
});
