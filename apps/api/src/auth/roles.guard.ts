import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import { IS_PUBLIC } from './public.decorator.js';
import { propertyIdsIn } from './request-properties.js';
import { ROLES_KEY, type PosRole } from './roles.decorator.js';

/** What this guard reads from the request. Runs before validation, so values are raw. */
export interface ScopedRequest extends AuthenticatedRequest {
  method?: string;
  url?: string;
  query?: Record<string, unknown>;
  body?: unknown;
}

/**
 * Global guard after AuthGuard: the caller needs one of the route's @Roles, and
 * every propertyId in the query or body must be in their property_ids
 * (INTEGRATION_DESIGN.md §8.3–8.4). Fails closed: a route without a rule is refused.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.enabled) return true;
    if (context.getType() !== 'http') return true; // the kitchen socket checks its own (step D)
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<ScopedRequest>();
    const route = `${request.method ?? '?'} ${request.url?.split('?')[0] ?? '?'}`;
    const caller = request.auth;
    // AuthGuard sets this; refuse rather than trust guard order.
    if (!caller) throw new UnauthorizedException('Missing or invalid access token');

    const allowed = this.reflector.getAllAndOverride<PosRole[] | undefined>(ROLES_KEY, targets);
    if (!allowed) {
      this.logger.error(`Route ${route} has no @Roles or @Public rule; refused`);
      throw new ForbiddenException('Not allowed');
    }
    if (!caller.roles.some((role) => (allowed as string[]).includes(role))) {
      this.logger.warn(`${caller.username} (roles: ${caller.roles.join(', ') || 'none'}) refused on ${route}`);
      throw new ForbiddenException('Your role does not allow this');
    }

    for (const propertyId of requestedProperties(request)) {
      if (!caller.propertyIds.includes(propertyId)) {
        this.logger.warn(`${caller.username} refused on ${route}: property ${propertyId} not in their property_ids`);
        throw new ForbiddenException('No access to this property');
      }
    }
    return true;
  }
}

/** Every propertyId the request names; at least one is required on a role-protected route. */
function requestedProperties(request: ScopedRequest): string[] {
  const values = propertyIdsIn(request);
  if (values.length === 0) throw new BadRequestException('propertyId is required');
  return values;
}
