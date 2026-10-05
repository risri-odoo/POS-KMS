import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MenuService } from './menu.service.js';
import { CreateMenuItemDto, ListMenuItemsDto, UpdateMenuItemDto } from './dto/menu-item.dto.js';

@ApiTags('menu')
@Controller('menu-items')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Post()
  @ApiOperation({ summary: 'Create a menu item' })
  @ApiResponse({ status: 201, description: 'The created menu item' })
  create(@Body() dto: CreateMenuItemDto) {
    return this.menuService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List menu items for a property' })
  @ApiResponse({ status: 200, description: 'Menu items ordered by category, sortOrder, name' })
  list(@Query() dto: ListMenuItemsDto) {
    return this.menuService.list(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a menu item' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'The updated menu item' })
  @ApiResponse({ status: 404, description: 'Menu item not found in this property' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateMenuItemDto,
  ) {
    return this.menuService.update(id, propertyId, dto);
  }
}
