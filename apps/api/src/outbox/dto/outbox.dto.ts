import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { outboxStatus } from '@stayx/database';

const OUTBOX_STATUSES = outboxStatus.enumValues;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export class ListOutboxDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ enum: OUTBOX_STATUSES })
  @IsOptional()
  @IsIn(OUTBOX_STATUSES)
  status?: OutboxStatus;
}

export class ResolveOutboxDto {
  @ApiPropertyOptional({ description: 'The HAIP charge id staff found on the folio, if known', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  haipChargeId?: string;
}
