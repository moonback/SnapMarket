import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DeliveryMode } from '@prisma/client';
import { PRODUCT_MAX_QUANTITY } from '@snapmarket/shared';
import { CursorQueryDto } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AddressDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) fullName!: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(120) line1!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) line2?: string;
  @ApiProperty() @Matches(/^\d{5}$/, { message: 'Code postal à 5 chiffres' }) postalCode!: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) city!: string;
  @ApiProperty({ enum: ['FR'] })
  @Equals('FR', { message: 'Livraison en France uniquement' })
  country!: 'FR';
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^(\+33|0)[1-9](\d{8})$/, { message: 'Numéro de téléphone invalide' })
  phone?: string;
}

export class CreateOrderDto {
  @ApiProperty() @IsString() productId!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PRODUCT_MAX_QUANTITY)
  quantity?: number;

  @ApiProperty({ enum: DeliveryMode }) @IsEnum(DeliveryMode) deliveryMode!: DeliveryMode;

  @ApiPropertyOptional({ description: 'Offre acceptée à appliquer' })
  @IsOptional()
  @IsString()
  offerId?: string;

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  shippingAddress?: AddressDto;
}

export class ListOrdersDto extends CursorQueryDto {
  @ApiProperty({ enum: ['buyer', 'seller'] })
  @IsIn(['buyer', 'seller'])
  role!: 'buyer' | 'seller';
}

export class ShipOrderDto {
  @ApiPropertyOptional({ description: 'Transporteur choisi par le vendeur' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  carrier?: string;

  @ApiPropertyOptional({ description: 'Numéro de suivi fourni par le transporteur' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{6,40}$/, { message: 'Numéro de suivi invalide' })
  trackingNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  trackingUrl?: string;
}

export class DisputeDto {
  @ApiProperty({ enum: ['NOT_RECEIVED', 'NOT_AS_DESCRIBED', 'DAMAGED', 'HANDOFF_ISSUE', 'OTHER'] })
  @IsIn(['NOT_RECEIVED', 'NOT_AS_DESCRIBED', 'DAMAGED', 'HANDOFF_ISSUE', 'OTHER'])
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  details?: string;
}

export class CancelOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}
