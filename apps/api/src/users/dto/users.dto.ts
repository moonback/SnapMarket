import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BIO_MAX, PASSWORD_MAX, USERNAME_REGEX } from '@snapmarket/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @Matches(USERNAME_REGEX, { message: 'Pseudonyme invalide' })
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(BIO_MAX)
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ description: 'Activer le classement « Pour vous » du flux' })
  @IsOptional()
  @IsBoolean()
  personalizedFeed?: boolean;

  @ApiPropertyOptional({ description: 'Identifiant d’un média AVATAR, ou null pour retirer' })
  @IsOptional()
  @IsString()
  avatarMediaId?: string | null;
}

export class DeleteAccountDto {
  @ApiProperty()
  @IsString()
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class PushTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxx]' })
  @IsString()
  @MaxLength(255)
  @Matches(/^Expo(nent)?PushToken\[[^\]]+\]$/, { message: 'Jeton push Expo invalide' })
  token!: string;

  @ApiProperty({ enum: ['ios', 'android'] })
  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';
}
