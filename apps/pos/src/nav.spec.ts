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
