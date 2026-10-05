import { describe, it, expect } from 'vitest';
import { canTransition, isFinalStatus, isOrderStatus, type OrderStatus } from './order-status.js';

const ALL: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready', 'delivered', 'cancelled'];

describe('order status state machine', () => {
  it('allows the happy path placed → accepted → preparing → ready → delivered', () => {
    expect(canTransition('placed', 'accepted')).toBe(true);
    expect(canTransition('accepted', 'preparing')).toBe(true);
    expect(canTransition('preparing', 'ready')).toBe(true);
    expect(canTransition('ready', 'delivered')).toBe(true);
  });

  it('rejects skipped steps', () => {
    expect(canTransition('placed', 'preparing')).toBe(false);
    expect(canTransition('placed', 'ready')).toBe(false);
    expect(canTransition('placed', 'delivered')).toBe(false);
    expect(canTransition('accepted', 'ready')).toBe(false);
    expect(canTransition('preparing', 'delivered')).toBe(false);
  });

  it('rejects backwards moves', () => {
    expect(canTransition('accepted', 'placed')).toBe(false);
    expect(canTransition('preparing', 'accepted')).toBe(false);
    expect(canTransition('ready', 'preparing')).toBe(false);
    expect(canTransition('delivered', 'ready')).toBe(false);
  });

  it('rejects staying in the same status', () => {
    for (const s of ALL) expect(canTransition(s, s)).toBe(false);
  });

  it('allows cancel from placed, accepted and preparing only', () => {
    expect(canTransition('placed', 'cancelled')).toBe(true);
    expect(canTransition('accepted', 'cancelled')).toBe(true);
    expect(canTransition('preparing', 'cancelled')).toBe(true);
    expect(canTransition('ready', 'cancelled')).toBe(false);
    expect(canTransition('delivered', 'cancelled')).toBe(false);
  });

  it('treats delivered and cancelled as final', () => {
    for (const to of ALL) {
      expect(canTransition('delivered', to)).toBe(false);
      expect(canTransition('cancelled', to)).toBe(false);
    }
    expect(isFinalStatus('delivered')).toBe(true);
    expect(isFinalStatus('cancelled')).toBe(true);
    expect(isFinalStatus('ready')).toBe(false);
  });

  it('isOrderStatus accepts known statuses and rejects anything else', () => {
    for (const s of ALL) expect(isOrderStatus(s)).toBe(true);
    expect(isOrderStatus('shipped')).toBe(false);
    expect(isOrderStatus('PLACED')).toBe(false);
    expect(isOrderStatus('toString')).toBe(false);
    expect(isOrderStatus(undefined)).toBe(false);
    expect(isOrderStatus(1)).toBe(false);
  });
});
