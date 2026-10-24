import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PRICE_MAX_CENTS, PRICE_MIN_CENTS } from '@snapmarket/shared';
import { CursorQueryDto } from '../../common/dto/pagination.dto';

export class CreateOfferDto {
  @ApiProperty() @IsString() productId!: string;

  @ApiProperty({ description: 'Montant proposé en centimes' })
  @IsInt()
  @Min(PRICE_MIN_CENTS)
  @Max(PRICE_MAX_CENTS)
  amountCents!: number;
}

export class ListOffersDto extends CursorQueryDto {
  @ApiProperty({ enum: ['buyer', 'seller'] })
  @IsIn(['buyer', 'seller'])
  role!: 'buyer' | 'seller';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productId?: string;
}
