import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { MESSAGE_MAX_LENGTH } from '@snapmarket/shared';

export class OpenConversationDto {
  @ApiPropertyOptional({ description: 'Annonce concernée (le vendeur devient l’interlocuteur)' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ description: 'Interlocuteur (si aucune annonce)' })
  @IsOptional()
  @IsString()
  userId?: string;
}

export class SendMessageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX_LENGTH)
  body?: string;

  @ApiPropertyOptional({ description: 'Média MESSAGE (photo)' })
  @IsOptional()
  @IsString()
  mediaId?: string;

  @ApiPropertyOptional({ description: 'Identifiant client unique pour l’idempotence (UUID)' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  clientMessageId?: string;
}
