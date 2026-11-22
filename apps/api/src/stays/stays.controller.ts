import { Controller, Get, Inject, Logger, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { STAY_LOOKUP, type StayLookup } from '../haip/stay-lookup.js';
import { LookupStaysDto } from './dto/lookup-stays.dto.js';
import { StayLookupRateLimitGuard } from './stay-lookup-rate-limit.guard.js';
import { toStayLookupResponse, type StayLookupResponse } from './stay-view.js';

/**
 * TODO(auth, AUDIT.md §7 items 7-10): unauthenticated for now, like the rest of
 * the POS API. It reveals in-house guests' first names and initials by room, so
 * it must be behind staff login before production. The rate limit is a stopgap.
 */
@ApiTags('stays')
@Controller('stays')
export class StaysController {
  private readonly logger = new Logger(StaysController.name);

  constructor(@Inject(STAY_LOOKUP) private readonly stayLookup: StayLookup) {}

  @Get('lookup')
  @UseGuards(StayLookupRateLimitGuard)
  @ApiOperation({
    summary: 'In-house stays for a room, so staff can confirm the guest before ordering',
    description:
      'Guests are returned as first name + surname initial only. status is found, none, unavailable ' +
      '(HAIP could not be asked) or not_configured (no stay lookup: place the order as unverified).',
  })
  @ApiResponse({ status: 200, description: 'Lookup result' })
  @ApiResponse({ status: 429, description: 'Too many lookups from this address' })
  async lookup(@Query() dto: LookupStaysDto): Promise<StayLookupResponse> {
    const result = await this.stayLookup.findInHouseByRoom(dto.propertyId, dto.roomNumber);
    // The reason stays in the server log; the screen only needs to know HAIP is unreachable.
    if (result.kind === 'unavailable') this.logger.warn(`Stay lookup unavailable: ${result.reason}`);
    return toStayLookupResponse(result);
  }
}
