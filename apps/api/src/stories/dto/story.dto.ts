import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { STORY_MAX_TTL_HOURS } from '@snapmarket/shared';

export class CreateStoryDto {
  @ApiProperty()
  @IsString()
  mediaId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  caption?: string;

  @ApiPropertyOptional({ description: 'Annonce liée (doit appartenir à l’auteur)' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({
    description: 'Durée de vie en heures (par défaut : paramètre plateforme)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(STORY_MAX_TTL_HOURS)
  ttlHours?: number;
}
