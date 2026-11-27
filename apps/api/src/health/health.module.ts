import { Module } from '@nestjs/common';
import { HaipModule } from '../haip/haip.module.js';
import { EventsModule } from '../events/events.module.js';
import { CHECK_TIMEOUT_MS, HealthService } from './health.service.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [HaipModule, EventsModule],
  controllers: [HealthController],
  providers: [HealthService, { provide: 'HEALTH_CHECK_TIMEOUT_MS', useValue: CHECK_TIMEOUT_MS }],
})
export class HealthModule {}
