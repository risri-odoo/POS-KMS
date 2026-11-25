import { Global, Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AUTH_CONFIG, loadAuthConfig, type AuthConfig } from './auth.config.js';
import { AuthGuard } from './auth.guard.js';
import { TOKEN_VERIFIER, TokenVerifier } from './token-verifier.js';

/** Staff login (INTEGRATION_DESIGN.md §8). Global, so the socket gateway can reuse the verifier. */
@Global()
@Module({
  providers: [
    {
      provide: AUTH_CONFIG,
      // Throws on unsafe settings, which stops the API from starting.
      useFactory: (): AuthConfig => {
        const config = loadAuthConfig();
        const logger = new Logger('Auth');
        if (config.enabled) {
          logger.log(`Staff login on: issuer ${config.issuer}, audience ${config.audience}, clients ${config.allowedAzp.join(', ')}`);
        } else {
          logger.warn('Staff login is OFF (POS_AUTH_ENABLED=false). Every route is open. Local development only.');
        }
        return config;
      },
    },
    {
      provide: TOKEN_VERIFIER,
      inject: [AUTH_CONFIG],
      useFactory: (config: AuthConfig) => (config.enabled ? new TokenVerifier(config) : null),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AUTH_CONFIG, TOKEN_VERIFIER],
})
export class AuthModule {}
