import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { HaipModule } from '../haip/haip.module.js';
import { MenuModule } from '../menu/menu.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [MenuModule, EventsModule, HaipModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
