import { CanActivate, ExecutionContext, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';
import { IS_PUBLIC } from './public.decorator.js';
import { InvalidTokenError, TOKEN_VERIFIER, type AuthPrincipal, type TokenVerifier } from './token-verifier.js';

/** The verified caller, set on the request by AuthGuard. Undefined when auth is off. */
export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  auth?: AuthPrincipal;
}

/**
 * Global guard: every HTTP route needs a valid bearer token unless marked @Public()
 * (INTEGRATION_DESIGN.md §8.3). The caller only learns "missing or invalid token";
 * the reason goes to the server log. With POS_AUTH_ENABLED=false everything passes.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.enabled) return true;
    if (context.getType() !== 'http') return true; // the kitchen socket checks its own handshake (step D)
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers['authorization'];
    const match = typeof header === 'string' ? header.match(/^Bearer\s+(\S+)$/i) : null;
    if (!match) throw new UnauthorizedException('Missing or invalid access token');

    try {
      request.auth = await this.verifier.verify(match[1]!);
      return true;
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        this.logger.warn(`Refused token: ${error.message}`);
        throw new UnauthorizedException('Missing or invalid access token');
      }
      throw error;
    }
  }
}
