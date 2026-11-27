import { BadRequestException } from '@nestjs/common';

/** What the property checks read from a request. Guards run before validation, so values are raw. */
export interface PropertyScopedRequest {
  query?: Record<string, unknown>;
  body?: unknown;
}

/**
 * Every propertyId the request names (query and body), possibly none. Each must be a
 * single string: a repeated or non-string propertyId is refused (400), so a second
 * hotel can't ride along with the first.
 */
export function propertyIdsIn(request: PropertyScopedRequest): string[] {
  const body = typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>) : {};
  const values = [request.query?.['propertyId'], body['propertyId']].filter((v) => v !== undefined);
  if (!values.every((v): v is string => typeof v === 'string')) throw new BadRequestException('propertyId must be a single value');
  return values;
}
