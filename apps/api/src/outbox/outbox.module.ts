import { Module } from '@nestjs/common';
import { HaipModule } from '../haip/haip.module.js';
import { EventsModule } from '../events/events.module.js';
import { OutboxController } from './outbox.controller.js';
import { OutboxService } from './outbox.service.js';

@Module({
  imports: [HaipModule, EventsModule],
  controllers: [OutboxController],
  providers: [OutboxService],
})
export class OutboxModule {}
