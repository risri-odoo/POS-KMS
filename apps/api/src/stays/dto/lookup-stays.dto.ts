import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class LookupStaysDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ example: '1204' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  roomNumber!: string;
}
