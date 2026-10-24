import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { DeliveryMode } from '@prisma/client';
import { PRODUCT_MAX_QUANTITY } from '@snapmarket/shared';
import { AddressDto } from '../../orders/dto/order.dto';

export class UpsertCartItemDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PRODUCT_MAX_QUANTITY)
  quantity?: number;

  @ApiPropertyOptional({ enum: DeliveryMode })
  @IsOptional()
  @IsEnum(DeliveryMode)
  deliveryMode?: DeliveryMode;
}

export class CartCheckoutDto {
  @ApiPropertyOptional({ type: AddressDto, description: 'Requise si un article est livré' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  shippingAddress?: AddressDto;
}
