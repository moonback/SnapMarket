import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ProposeMeetupDto {
  @ApiProperty({ description: 'Date et heure (ISO 8601)' })
  @IsISO8601({ strict: true })
  scheduledAt!: string;

  @ApiProperty({ description: 'Lieu public choisi par les participants (texte libre)' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  locationLabel!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;
}
