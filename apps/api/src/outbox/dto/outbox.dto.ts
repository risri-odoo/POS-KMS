import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { outboxStatus, parkedReason, resolutionType } from '@stayx/database';

const OUTBOX_STATUSES = outboxStatus.enumValues;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];
const PARKED_REASONS = parkedReason.enumValues;
export type ParkedReason = (typeof PARKED_REASONS)[number];
export const RESOLUTION_TYPES = resolutionType.enumValues;
export type ResolutionType = (typeof RESOLUTION_TYPES)[number];

/** attention: rows a person has to deal with (needs_attention and failed). */
export const OUTBOX_VIEWS = ['attention', 'all'] as const;
export type OutboxView = (typeof OUTBOX_VIEWS)[number];

export const NOTE_MIN = 3;
export const NOTE_MAX = 500;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListOutboxDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ enum: OUTBOX_VIEWS, default: 'attention', description: 'Ignored when status is given' })
  @IsOptional()
  @IsIn(OUTBOX_VIEWS)
  view?: OutboxView;

  @ApiPropertyOptional({ enum: OUTBOX_STATUSES })
  @IsOptional()
  @IsIn(OUTBOX_STATUSES)
  status?: OutboxStatus;

  @ApiPropertyOptional({ enum: PARKED_REASONS })
  @IsOptional()
  @IsIn(PARKED_REASONS)
  parkedReason?: ParkedReason;

  @ApiPropertyOptional({ enum: RESOLUTION_TYPES })
  @IsOptional()
  @IsIn(RESOLUTION_TYPES)
  resolutionType?: ResolutionType;

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class OutboxSummaryDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  propertyId!: string;
}

export class RetryOutboxDto {
  @ApiPropertyOptional({ description: 'Why it is being sent again (optional)', maxLength: NOTE_MAX })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

export class ResolveOutboxDto {
  @ApiProperty({
    enum: RESOLUTION_TYPES,
    description:
      'posted_manually: added to the folio in HAIP by staff (row becomes posted). collected_otherwise, written_off, ' +
      'duplicate_or_error: closed without a folio charge (row becomes resolved).',
  })
  @IsIn(RESOLUTION_TYPES)
  resolutionType!: ResolutionType;

  @ApiProperty({ description: 'What was done and why', minLength: NOTE_MIN, maxLength: NOTE_MAX })
  @Transform(trim)
  @IsString()
  @MinLength(NOTE_MIN)
  @MaxLength(NOTE_MAX)
  note!: string;

  /** Only with posted_manually; the service answers 400 otherwise. */
  @ApiPropertyOptional({ description: 'The HAIP charge id on the folio. Only with posted_manually.', maxLength: 64 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  haipChargeId?: string;
}
