import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { EventsModule } from './events/events.module.js';
import { HaipModule } from './haip/haip.module.js';
import { MenuModule } from './menu/menu.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { OutboxModule } from './outbox/outbox.module.js';

@Module({
  imports: [DatabaseModule, EventsModule, HaipModule, MenuModule, OrdersModule, OutboxModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
