import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthPrincipal } from './token-verifier.js';

/** POS client roles (INTEGRATION_DESIGN.md §8.1). HAIP realm roles never count. */
export const POS_ROLES = ['pos_staff', 'pos_kitchen', 'pos_manager'] as const;
export type PosRole = (typeof POS_ROLES)[number];

export const ROLES_KEY = 'stayx:roles';

/**
 * Which POS roles may call this route (§8.4). Every route needs either this or
 * @Public(); a route with neither is refused while auth is on. The request's
 * propertyId must also be in the caller's property_ids.
 */
export const Roles = (...roles: PosRole[]) => SetMetadata(ROLES_KEY, roles);

/** The verified caller, or undefined when auth is off (POS_AUTH_ENABLED=false). */
export const Caller = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal | undefined =>
    context.switchToHttp().getRequest<{ auth?: AuthPrincipal }>().auth,
);
