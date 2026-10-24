import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReportReason, ReportTargetType } from '@prisma/client';

export class CreateReportDto {
  @ApiProperty({ enum: ReportTargetType }) @IsEnum(ReportTargetType) targetType!: ReportTargetType;
  @ApiProperty() @IsString() @MaxLength(40) targetId!: string;
  @ApiProperty({ enum: ReportReason }) @IsEnum(ReportReason) reason!: ReportReason;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(1000)
  details?: string;
}
