import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Caller, Roles } from '../auth/roles.decorator.js';
import type { AuthPrincipal } from '../auth/token-verifier.js';
import { OrdersService } from './orders.service.js';
import { CreateOrderDto, ListOrdersDto, UpdateOrderStatusDto } from './dto/order.dto.js';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  // Confirmed and unverified orders alike; never the kitchen (§8.1).
  @Roles('pos_staff', 'pos_manager')
  @ApiOperation({ summary: 'Place a room-service order (priced server-side from the menu)' })
  @ApiResponse({ status: 201, description: 'The order with its item snapshots' })
  @ApiResponse({
    status: 400,
    description: 'Unknown/unavailable item, mixed currencies, or neither a confirmed stay nor unverified: true',
  })
  @ApiResponse({
    status: 409,
    description: 'Stay no longer in-house in that room, guest name not on the stay, no in-house guest, or unverified while the lookup works',
  })
  @ApiResponse({ status: 503, description: 'HAIP unreachable while checking the stay: retry, or place as unverified' })
  create(@Body() dto: CreateOrderDto, @Caller() caller?: AuthPrincipal) {
    return this.ordersService.create(dto, caller);
  }

  @Get()
  @Roles('pos_staff', 'pos_kitchen', 'pos_manager')
  @ApiOperation({ summary: 'List orders for a property, newest first' })
  @ApiResponse({ status: 200, description: 'Orders (without items)' })
  list(@Query() dto: ListOrdersDto) {
    return this.ordersService.list(dto);
  }

  @Get(':id')
  @Roles('pos_staff', 'pos_kitchen', 'pos_manager')
  @ApiOperation({ summary: 'Get an order with its items' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'The order with items' })
  @ApiResponse({ status: 404, description: 'Order not found in this property' })
  findById(@Param('id', ParseUUIDPipe) id: string, @Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.ordersService.findById(id, propertyId);
  }

  @Patch(':id/status')
  @Roles('pos_kitchen', 'pos_manager')
  @ApiOperation({ summary: 'Move an order through its lifecycle' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'The updated order' })
  @ApiResponse({ status: 400, description: 'Illegal status transition' })
  @ApiResponse({ status: 404, description: 'Order not found in this property' })
  @ApiResponse({ status: 409, description: 'Order status changed concurrently' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, propertyId, dto.status);
  }
}
