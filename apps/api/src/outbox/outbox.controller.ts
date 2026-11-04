import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OutboxService } from './outbox.service.js';
import { ListOutboxDto, ResolveOutboxDto } from './dto/outbox.dto.js';

@ApiTags('outbox')
@Controller('outbox')
export class OutboxController {
  constructor(private readonly outboxService: OutboxService) {}

  @Get()
  @ApiOperation({ summary: 'List HAIP folio posts for a property, newest first' })
  @ApiResponse({ status: 200, description: 'Outbox rows' })
  list(@Query() dto: ListOutboxDto) {
    return this.outboxService.list(dto);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-send a needs_attention or failed post to HAIP',
    description:
      'For a FAILED row, check the guest folio in HAIP first: the charge may already be posted. ' +
      'Rows parked because the room had no in-house guest cannot be retried (409); post them in HAIP and resolve.',
  })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'The row, back to pending and queued' })
  @ApiResponse({ status: 400, description: 'Row is not needs_attention or failed' })
  @ApiResponse({ status: 404, description: 'Not found in this property' })
  @ApiResponse({ status: 409, description: 'Parked because the room had no in-house guest: resolve only' })
  retry(@Param('id', ParseUUIDPipe) id: string, @Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.outboxService.retry(id, propertyId);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a needs_attention or failed post as posted (verified manually in HAIP)' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'The row, now posted' })
  @ApiResponse({ status: 400, description: 'Row is not needs_attention or failed' })
  @ApiResponse({ status: 404, description: 'Not found in this property' })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: ResolveOutboxDto,
  ) {
    return this.outboxService.resolve(id, propertyId, dto.haipChargeId);
  }
}
