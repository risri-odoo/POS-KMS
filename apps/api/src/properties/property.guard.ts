import { CanActivate, ExecutionContext, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../auth/public.decorator.js';
import { propertyIdsIn, type PropertyScopedRequest } from '../auth/request-properties.js';
import { PROPERTY_DIRECTORY, type PropertyDirectory } from './properties.service.js';

/**
 * Global guard, registered after AuthGuard and RolesGuard (AUDIT.md item 4): every hotel a
 * request names must be a known, active property; otherwise 404 "Unknown property".
 * It runs after the login checks so that, without a valid token, the answer is 401 and
 * nobody can probe which hotels exist. Applies with login off too.
 */
@Injectable()
export class PropertyGuard implements CanActivate {
  private readonly logger = new Logger(PropertyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(PROPERTY_DIRECTORY) private readonly directory: PropertyDirectory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true; // the kitchen socket checks joinProperty itself
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;

    const request = context.switchToHttp().getRequest<PropertyScopedRequest>();
    for (const propertyId of propertyIdsIn(request)) {
      if (!(await this.directory.find(propertyId))) {
        this.logger.warn(`Refused: unknown or inactive property ${propertyId}`);
        throw new NotFoundException('Unknown property');
      }
    }
    return true;
  }
}
