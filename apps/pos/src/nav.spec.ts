import { describe, expect, it } from 'vitest';
import { navFor } from './App.js';

const labels = (sections: ReturnType<typeof navFor>) => sections.flatMap((s) => s.items.map((i) => i.label));

describe('navFor', () => {
  it('staff see only Orders', () => {
    expect(labels(navFor('order', false))).toEqual(['Orders']);
  });

  it('managers (and login off) also see Menu and Outbox/Errors', () => {
    expect(labels(navFor('menu', true))).toEqual(['Orders', 'Menu', 'Outbox/Errors']);
  });
});
