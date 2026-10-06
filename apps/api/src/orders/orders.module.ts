import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { MenuModule } from '../menu/menu.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [MenuModule, EventsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
