import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  PRICE_MAX_CENTS,
  PRICE_MIN_CENTS,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_MAX_MEDIA,
  PRODUCT_MAX_QUANTITY,
  PRODUCT_TITLE_MAX,
  PRODUCT_TITLE_MIN,
  SHIPPING_FEE_MAX_CENTS,
} from '@snapmarket/shared';
import { DeliveryMode, ProductCondition, ProductStatus } from '@prisma/client';
import { CursorQueryDto } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toArray = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : Array.isArray(value) ? value : String(value).split(',');

export class CreateProductDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(PRODUCT_TITLE_MIN)
  @MaxLength(PRODUCT_TITLE_MAX)
  title!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MaxLength(PRODUCT_DESCRIPTION_MAX)
  description!: string;

  @ApiProperty({ description: 'Prix en centimes d’euro' })
  @IsInt()
  @Min(PRICE_MIN_CENTS)
  @Max(PRICE_MAX_CENTS)
  priceCents!: number;

  @ApiProperty()
  @IsString()
  categoryId!: string;

  @ApiProperty({ enum: ProductCondition })
  @IsEnum(ProductCondition)
  condition!: ProductCondition;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  brand?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PRODUCT_MAX_QUANTITY)
  quantity?: number;

  @ApiProperty({ enum: DeliveryMode, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(DeliveryMode, { each: true })
  deliveryModes!: DeliveryMode[];

  @ApiPropertyOptional({ description: 'Frais de livraison en centimes (requis si livraison)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SHIPPING_FEE_MAX_CENTS)
  shippingFeeCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{5}$/)
  postalCode?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  offersEnabled?: boolean;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(PRODUCT_MAX_MEDIA)
  @IsString({ each: true })
  mediaIds!: string[];

  @ApiPropertyOptional({ description: 'Publier immédiatement (sinon brouillon)' })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export const PRODUCT_SORTS = ['recent', 'price_asc', 'price_desc'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export class SearchProductsDto extends CursorQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPriceCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPriceCents?: number;

  @ApiPropertyOptional({ enum: ProductCondition, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsEnum(ProductCondition, { each: true })
  conditions?: ProductCondition[];

  @ApiPropertyOptional({ enum: DeliveryMode })
  @IsOptional()
  @IsEnum(DeliveryMode)
  deliveryMode?: DeliveryMode;

  @ApiPropertyOptional({ description: 'Ville (correspondance exacte, insensible à la casse)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ description: 'Département (2 ou 3 premiers chiffres du code postal)' })
  @IsOptional()
  @Matches(/^\d{2,3}$/)
  department?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sellerId?: string;

  @ApiPropertyOptional({ enum: PRODUCT_SORTS, default: 'recent' })
  @IsOptional()
  @IsIn(PRODUCT_SORTS as unknown as string[])
  sort?: ProductSort;
}

export class MyProductsDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
