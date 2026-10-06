import { Module } from '@nestjs/common';
import { KitchenGateway } from './kitchen.gateway.js';
import { OrderEventsService } from './order-events.service.js';

@Module({
  providers: [KitchenGateway, OrderEventsService],
  exports: [KitchenGateway, OrderEventsService],
})
export class EventsModule {}
