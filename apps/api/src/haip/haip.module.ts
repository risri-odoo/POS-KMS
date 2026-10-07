import { Module } from '@nestjs/common';
import { HaipClient } from './haip-client.js';
import { HAIP_CONFIG, loadHaipConfig, type HaipConfig } from './haip.config.js';
import { HaipQueue } from './haip-queue.service.js';
import { HAIP_CLIENT, OutboxProcessor } from './outbox.processor.js';
import { OutboxWorker } from './outbox.worker.js';

@Module({
  providers: [
    // Read once at startup (after main.ts has loaded pos/.env).
    { provide: HAIP_CONFIG, useFactory: (): HaipConfig => loadHaipConfig() },
    {
      provide: HAIP_CLIENT,
      inject: [HAIP_CONFIG],
      useFactory: (config: HaipConfig) => new HaipClient({ apiUrl: config.apiUrl, apiKey: config.apiKey ?? '' }),
    },
    HaipQueue,
    OutboxProcessor,
    OutboxWorker,
  ],
  exports: [HAIP_CONFIG, HaipQueue],
})
export class HaipModule {}
