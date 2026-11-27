import { describe, expect, it } from 'vitest';
import { navFor, tabFromHash } from './App.js';

const items = (sections: ReturnType<typeof navFor>) => sections.flatMap((s) => s.items);
const labels = (sections: ReturnType<typeof navFor>) => items(sections).map((i) => i.label);

describe('navFor', () => {
  it('staff see only Orders', () => {
    expect(labels(navFor('order', false))).toEqual(['Orders']);
  });

  it('managers (and login off) also see Menu and Outbox/Errors, which is live now', () => {
    expect(labels(navFor('menu', true))).toEqual(['Orders', 'Menu', 'Outbox/Errors']);
    const outbox = items(navFor('outbox', true)).find((i) => i.label === 'Outbox/Errors')!;
    expect(outbox).toMatchObject({ href: '#outbox', active: true });
    expect(outbox.disabled).toBeFalsy();
  });
});

describe('tabFromHash', () => {
  it('opens Menu and Outbox/Errors for managers only', () => {
    expect(tabFromHash('#outbox', true)).toBe('outbox');
    expect(tabFromHash('#menu', true)).toBe('menu');
    expect(tabFromHash('#outbox', false)).toBe('order');
    expect(tabFromHash('#menu', false)).toBe('order');
    expect(tabFromHash('', true)).toBe('order');
  });
});

describe('navFor with alerts', () => {
  it('puts the count or the warning dot on Outbox/Errors only', () => {
    const withBadge = items(navFor('order', true, { badge: 3 }));
    expect(withBadge.find((i) => i.label === 'Outbox/Errors')).toMatchObject({ badge: 3 });
    expect(withBadge.find((i) => i.label === 'Orders')!.badge).toBeUndefined();
    expect(items(navFor('order', true, { alert: 'HAIP posting is off.' })).find((i) => i.label === 'Outbox/Errors')).toMatchObject({ alert: 'HAIP posting is off.' });
    expect(labels(navFor('order', false, { badge: 3 }))).toEqual(['Orders']); // staff: no Outbox tab at all
  });
});
