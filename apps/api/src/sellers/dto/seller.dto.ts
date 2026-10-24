import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AddressDto } from '../../orders/dto/order.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\s/g, '') : value;

export class ProRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  companyName!: string;

  @ApiProperty({ description: 'SIRET (14 chiffres)' })
  @Transform(trim)
  @Matches(/^\d{14}$/, { message: 'Le SIRET doit comporter 14 chiffres' })
  siret!: string;

  @ApiPropertyOptional({ description: 'Numéro de TVA intracommunautaire' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^FR[0-9A-Z]{2}\d{9}$/, { message: 'Numéro de TVA invalide' })
  vatNumber?: string;

  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  legalAddress!: AddressDto;
}
