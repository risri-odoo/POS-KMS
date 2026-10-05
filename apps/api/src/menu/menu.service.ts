import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { menuItems } from '@stayx/database';
import { DRIZZLE, type Db } from '../database/database.module.js';
import type { CreateMenuItemDto, ListMenuItemsDto, UpdateMenuItemDto } from './dto/menu-item.dto.js';

export type MenuItem = typeof menuItems.$inferSelect;

@Injectable()
export class MenuService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async create(dto: CreateMenuItemDto): Promise<MenuItem> {
    const [item] = await this.db
      .insert(menuItems)
      .values({
        propertyId: dto.propertyId,
        category: dto.category,
        name: dto.name,
        description: dto.description,
        price: dto.price,
        currencyCode: dto.currencyCode.toUpperCase(),
        isAvailable: dto.isAvailable ?? true,
        sortOrder: dto.sortOrder ?? 0,
      })
      .returning();
    return item!;
  }

  async list(dto: ListMenuItemsDto): Promise<MenuItem[]> {
    const conditions = [eq(menuItems.propertyId, dto.propertyId)];
    if (dto.availableOnly === 'true') conditions.push(eq(menuItems.isAvailable, true));

    return this.db
      .select()
      .from(menuItems)
      .where(and(...conditions))
      .orderBy(asc(menuItems.category), asc(menuItems.sortOrder), asc(menuItems.name));
  }

  async update(id: string, propertyId: string, dto: UpdateMenuItemDto): Promise<MenuItem> {
    const [item] = await this.db
      .update(menuItems)
      .set({
        name: dto.name,
        price: dto.price,
        category: dto.category,
        description: dto.description,
        isAvailable: dto.isAvailable,
        sortOrder: dto.sortOrder,
        updatedAt: new Date(),
      })
      .where(and(eq(menuItems.id, id), eq(menuItems.propertyId, propertyId)))
      .returning();
    if (!item) throw new NotFoundException(`Menu item ${id} not found`);
    return item;
  }

  /** Load the given menu items for one property (used by order pricing). */
  async findByIds(ids: string[], propertyId: string, db: Db = this.db): Promise<MenuItem[]> {
    if (ids.length === 0) return [];
    return db
      .select()
      .from(menuItems)
      .where(and(inArray(menuItems.id, ids), eq(menuItems.propertyId, propertyId)));
  }
}
