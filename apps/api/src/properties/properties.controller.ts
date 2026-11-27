import { Controller, Get, Inject, NotFoundException, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { Roles } from '../auth/roles.decorator.js';
import { PROPERTY_DIRECTORY, type PropertyDirectory } from './properties.service.js';

export class CurrentPropertyDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  propertyId!: string;
}

/** What the screens need about their hotel. Never the key or its variable name. */
export interface PublicProperty {
  id: string;
  name: string;
  currencyCode: string;
  timezone: string;
}

@ApiTags('properties')
@Controller('properties')
export class PropertiesController {
  constructor(@Inject(PROPERTY_DIRECTORY) private readonly directory: PropertyDirectory) {}

  @Get('current')
  @Roles('pos_staff', 'pos_kitchen', 'pos_manager')
  @ApiOperation({ summary: "The hotel's name, currency and timezone (e.g. for the menu screen)" })
  @ApiResponse({ status: 200, description: '{ id, name, currencyCode, timezone }' })
  @ApiResponse({ status: 404, description: 'Unknown or inactive property' })
  async current(@Query() dto: CurrentPropertyDto): Promise<PublicProperty> {
    const property = await this.directory.find(dto.propertyId);
    if (!property) throw new NotFoundException('Unknown property');
    return { id: property.id, name: property.name, currencyCode: property.currencyCode, timezone: property.timezone };
  }
}
