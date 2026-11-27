import { Module } from '@nestjs/common';
import { KitchenGateway } from './kitchen.gateway.js';
import { OrderEventsService } from './order-events.service.js';
import { OUTBOX_ALERT_CONFIG, OutboxAlerts, loadOutboxAlertConfig } from './outbox-alerts.service.js';

@Module({
  providers: [
    KitchenGateway,
    OrderEventsService,
    // Throws on a bad OUTBOX_STUCK_AFTER_MINUTES, which stops the API from starting.
    { provide: OUTBOX_ALERT_CONFIG, useFactory: () => loadOutboxAlertConfig() },
    { provide: 'NOW', useValue: Date.now },
    OutboxAlerts,
  ],
  exports: [KitchenGateway, OrderEventsService, OutboxAlerts],
})
export class EventsModule {}
