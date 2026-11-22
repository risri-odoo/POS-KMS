import { Module } from '@nestjs/common';
import { HaipModule } from '../haip/haip.module.js';
import { StayLookupRateLimitGuard } from './stay-lookup-rate-limit.guard.js';
import { StaysController } from './stays.controller.js';

@Module({
  imports: [HaipModule],
  controllers: [StaysController],
  providers: [StayLookupRateLimitGuard],
})
export class StaysModule {}
