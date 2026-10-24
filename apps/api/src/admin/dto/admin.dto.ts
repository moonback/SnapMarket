import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  DisputeStatus,
  ModerationStatus,
  OrderStatus,
  ReportStatus,
  ReportTargetType,
  SellerVerificationStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { MODERATABLE } from '../../moderation/moderation.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PageQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class AdminUsersQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: UserStatus }) @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @ApiPropertyOptional({ enum: UserRole }) @IsOptional() @IsEnum(UserRole) role?: UserRole;
}

export class ReasonDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UserStatusDto extends ReasonDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'BANNED'] })
  @IsIn(['ACTIVE', 'SUSPENDED', 'BANNED'])
  status!: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
}

export class UserRoleDto {
  @ApiProperty({
    enum: ['USER', 'MODERATOR'],
    description: 'Le rôle ADMIN ne s’attribue que par la procédure CLI',
  })
  @IsIn(['USER', 'MODERATOR'])
  role!: 'USER' | 'MODERATOR';
}

export class SellersQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: SellerVerificationStatus })
  @IsOptional()
  @IsEnum(SellerVerificationStatus)
  verificationStatus?: SellerVerificationStatus;
}

export class SellerDecisionDto {
  @ApiProperty({ enum: ['VERIFIED', 'REJECTED'] })
  @IsIn(['VERIFIED', 'REJECTED'])
  decision!: 'VERIFIED' | 'REJECTED';

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdminProductsQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: ModerationStatus })
  @IsOptional()
  @IsEnum(ModerationStatus)
  moderationStatus?: ModerationStatus;
}

export class ContentModerationDto extends ReasonDto {
  @ApiProperty({ enum: ['APPROVE', 'HIDE', 'REMOVE', 'RESTORE'] })
  @IsIn(['APPROVE', 'HIDE', 'REMOVE', 'RESTORE'])
  action!: 'APPROVE' | 'HIDE' | 'REMOVE' | 'RESTORE';
}

export class ContentTypeParam {
  @IsIn(MODERATABLE as unknown as string[])
  type!: (typeof MODERATABLE)[number];

  @IsString()
  @MaxLength(40)
  id!: string;
}

export class AdminOrdersQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

export class DisputesQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: DisputeStatus })
  @IsOptional()
  @IsEnum(DisputeStatus)
  status?: DisputeStatus;
}

export class ResolveDisputeDto {
  @ApiProperty({ enum: ['REFUND', 'RELEASE'] })
  @IsIn(['REFUND', 'RELEASE'])
  resolution!: 'REFUND' | 'RELEASE';

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  note!: string;
}

export class ReportsQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;
  @ApiPropertyOptional({ enum: ReportTargetType })
  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;
}

export class ResolveReportDto {
  @ApiProperty({ enum: ['RESOLVED', 'DISMISSED'] })
  @IsIn(['RESOLVED', 'DISMISSED'])
  status!: 'RESOLVED' | 'DISMISSED';

  @ApiPropertyOptional({ enum: ['HIDE', 'REMOVE'], description: 'Action sur le contenu signalé' })
  @IsOptional()
  @IsIn(['HIDE', 'REMOVE'])
  contentAction?: 'HIDE' | 'REMOVE';

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AuditQuery extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() actorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
}
