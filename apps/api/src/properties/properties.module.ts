import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PROPERTY_CACHE_MS, PROPERTY_DIRECTORY, PropertiesService } from './properties.service.js';
import { PropertyGuard } from './property.guard.js';

/**
 * Known hotels (AUDIT.md item 4). Imported in AppModule AFTER AuthModule: global guards run
 * in registration order, so this guard comes after the login and role checks.
 */
@Global()
@Module({
  providers: [
    { provide: 'PROPERTY_CACHE_MS', useValue: PROPERTY_CACHE_MS },
    { provide: 'NOW', useValue: Date.now },
    PropertiesService,
    { provide: PROPERTY_DIRECTORY, useExisting: PropertiesService },
    { provide: APP_GUARD, useClass: PropertyGuard },
  ],
  exports: [PROPERTY_DIRECTORY],
})
export class PropertiesModule {}
