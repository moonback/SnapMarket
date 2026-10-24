import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ALLOWED_MIME_TYPES, MEDIA_LIMITS } from '@snapmarket/shared';
import { MediaPurpose } from '@prisma/client';

export class CreateUploadDto {
  @ApiProperty({ enum: ALLOWED_MIME_TYPES })
  @IsIn(ALLOWED_MIME_TYPES as unknown as string[])
  mimeType!: string;

  @ApiProperty({ description: 'Taille exacte du fichier en octets' })
  @IsInt()
  @Min(1)
  @Max(MEDIA_LIMITS.VIDEO.maxBytes)
  sizeBytes!: number;

  @ApiProperty({ enum: MediaPurpose })
  @IsEnum(MediaPurpose)
  purpose!: MediaPurpose;

  @ApiProperty({ required: false, description: 'Durée déclarée (vidéo), en secondes' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MEDIA_LIMITS.VIDEO.maxDurationSeconds)
  durationSeconds?: number;
}
