import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { EventsModule } from './events/events.module.js';
import { HaipModule } from './haip/haip.module.js';
import { HealthModule } from './health/health.module.js';
import { MenuModule } from './menu/menu.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { PropertiesModule } from './properties/properties.module.js';
import { StaysModule } from './stays/stays.module.js';

@Module({
  // AuthModule then PropertiesModule: their global guards run in this order (login, roles, hotel).
  imports: [AuthModule, PropertiesModule, DatabaseModule, EventsModule, HaipModule, HealthModule, MenuModule, OrdersModule, OutboxModule, StaysModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
