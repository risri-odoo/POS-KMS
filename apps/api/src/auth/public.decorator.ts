import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'stayx:isPublic';

/** Lets a route through without a token. Keep this to service checks. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
