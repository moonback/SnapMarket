import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_MAX, PASSWORD_MIN, USERNAME_REGEX } from '@snapmarket/shared';

const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PasswordField {
  @ApiProperty({ minLength: PASSWORD_MIN })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  @Matches(/[a-z]/, { message: 'Le mot de passe doit contenir une minuscule' })
  @Matches(/[A-Z]/, { message: 'Le mot de passe doit contenir une majuscule' })
  @Matches(/[0-9]/, { message: 'Le mot de passe doit contenir un chiffre' })
  password!: string;
}

export class RegisterDto extends PasswordField {
  @ApiProperty()
  @Transform(lower)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @Transform(trim)
  @Matches(USERNAME_REGEX, { message: 'Pseudonyme invalide' })
  username!: string;

  @ApiProperty({ description: 'Acceptation des CGU (obligatoire)' })
  @IsBoolean()
  @Equals(true, { message: 'Vous devez accepter les conditions' })
  acceptTerms!: boolean;
}

export class LoginDto {
  @ApiProperty()
  @Transform(lower)
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refreshToken!: string;
}

export class TokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @Transform(lower)
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto extends PasswordField {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;
}

export class ChangePasswordDto extends PasswordField {
  @ApiProperty()
  @IsString()
  @MaxLength(PASSWORD_MAX)
  currentPassword!: string;
}
