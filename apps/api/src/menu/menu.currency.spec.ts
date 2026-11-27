import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../database/database.module.js';
import type { PropertyDirectory } from '../properties/properties.service.js';
import { MenuService } from './menu.service.js';

const A = 'a0000001-0000-4000-a000-000000000001';
const usdHotel: PropertyDirectory = {
  find: (id: string) => Promise.resolve(id === A ? ({ id, name: 'Demo hotel', currencyCode: 'USD' } as never) : null),
};

/** A db that records what would be inserted. */
function capture() {
  const values = vi.fn();
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        values(v);
        return { returning: () => Promise.resolve([{ id: 'm1', ...v }]) };
      },
    }),
  } as unknown as Db;
  return { db, values };
}

const item = { propertyId: A, name: 'Green tea', price: '5.00' };

describe('MenuService.create: the hotel’s currency (AUDIT.md item 5)', () => {
  it('uses the hotel’s currency when none is given', async () => {
    const { db, values } = capture();
    await new MenuService(db, usdHotel).create(item);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ currencyCode: 'USD' }));
  });

  it('accepts the hotel’s currency in any case', async () => {
    const { db, values } = capture();
    await new MenuService(db, usdHotel).create({ ...item, currencyCode: 'usd' });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ currencyCode: 'USD' }));
  });

  it('refuses another currency, saying which one the hotel uses, and writes nothing', async () => {
    const { db, values } = capture();
    await expect(new MenuService(db, usdHotel).create({ ...item, currencyCode: 'EUR' })).rejects.toThrow(
      'Menu items for Demo hotel must be priced in USD, not EUR',
    );
    expect(values).not.toHaveBeenCalled();
  });

  it('404 for an unknown hotel', async () => {
    const { db } = capture();
    await expect(new MenuService(db, usdHotel).create({ ...item, propertyId: 'b0000002-0000-4000-a000-000000000002' })).rejects.toThrow('Unknown property');
  });
});
