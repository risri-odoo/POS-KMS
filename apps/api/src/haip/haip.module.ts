import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { HaipClient } from './haip-client.js';
import { HAIP_CONFIG, loadHaipConfig, type HaipConfig } from './haip.config.js';
import { HaipQueue } from './haip-queue.service.js';
import { HAIP_CLIENT, OutboxProcessor } from './outbox.processor.js';
import { OutboxWorker } from './outbox.worker.js';
import { createStayLookup } from './stay-lookup.config.js';
import { STAY_LOOKUP } from './stay-lookup.js';

@Module({
  // The processor tells OutboxAlerts when a charge changes (AUDIT.md item 15).
  imports: [EventsModule],
  providers: [
    // Read once at startup (after main.ts has loaded pos/.env).
    { provide: HAIP_CONFIG, useFactory: (): HaipConfig => loadHaipConfig() },
    {
      provide: HAIP_CLIENT,
      inject: [HAIP_CONFIG],
      useFactory: (config: HaipConfig) => new HaipClient({ apiUrl: config.apiUrl }),
    },
    // Throws for HAIP_STAY_LOOKUP=fake in production, which stops the API from starting.
    { provide: STAY_LOOKUP, useFactory: () => createStayLookup() },
    HaipQueue,
    OutboxProcessor,
    OutboxWorker,
  ],
  exports: [HAIP_CONFIG, HaipQueue, STAY_LOOKUP],
})
export class HaipModule {}
