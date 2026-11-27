import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator.js';
import { Caller } from '../auth/roles.decorator.js';
import type { AuthPrincipal } from '../auth/token-verifier.js';
import { OutboxService } from './outbox.service.js';
import { ListOutboxDto, OutboxSummaryDto, ResolveOutboxDto, RetryOutboxDto } from './dto/outbox.dto.js';

@ApiTags('outbox')
@Controller('outbox')
export class OutboxController {
  constructor(private readonly outboxService: OutboxService) {}

  @Get()
  @Roles('pos_manager')
  @ApiOperation({
    summary: 'HAIP folio posts for a property, newest first, each with its order',
    description: 'By default only rows that need a person (needs_attention, failed); view=all for every row. Filters: status, parkedReason, resolutionType.',
  })
  @ApiResponse({ status: 200, description: 'Outbox rows, each with its order (number, room, guest, amount)' })
  list(@Query() dto: ListOutboxDto) {
    return this.outboxService.list(dto);
  }

  @Get('summary')
  @Roles('pos_manager')
  @ApiOperation({ summary: 'How many charges need a manager: needs attention, failed and stuck (the badge count)' })
  @ApiResponse({ status: 200, description: '{ needsAttention, failed, stuck, total, oldestAt, stuckAfterMinutes, bridgeEnabled }' })
  summary(@Query() dto: OutboxSummaryDto) {
    return this.outboxService.summary(dto.propertyId);
  }

  @Post(':id/retry')
  @Roles('pos_manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-send a needs_attention or failed post to HAIP',
    description:
      'For a FAILED row, check the guest folio in HAIP first: the charge may already be posted. ' +
      'Rows parked as no_in_house_guest, stay_ended, needs_verification or wrong_property cannot be retried (409); ' +
      'post them in HAIP and resolve. haip_rejected rows can be retried once the data is fixed.',
  })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'The row, back to pending and queued' })
  @ApiResponse({ status: 400, description: 'Row is not needs_attention or failed' })
  @ApiResponse({ status: 404, description: 'Not found in this property' })
  @ApiResponse({ status: 409, description: 'Parked for a resolve-only reason (see parkedReason)' })
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: RetryOutboxDto,
    @Caller() caller?: AuthPrincipal,
  ) {
    return this.outboxService.retry(id, propertyId, dto, caller);
  }

  @Post(':id/resolve')
  @Roles('pos_manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close a needs_attention or failed post without sending it',
    description:
      'resolutionType and a note are required. posted_manually (optionally with the HAIP charge id) marks it posted; ' +
      'collected_otherwise, written_off and duplicate_or_error mark it resolved (no folio charge).',
  })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'The row, now posted or resolved' })
  @ApiResponse({ status: 400, description: 'Row is not needs_attention or failed' })
  @ApiResponse({ status: 404, description: 'Not found in this property' })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: ResolveOutboxDto,
    @Caller() caller?: AuthPrincipal,
  ) {
    return this.outboxService.resolve(id, propertyId, dto, caller);
  }
}
