import { Injectable, NotFoundException } from '@nestjs/common';
import { Category } from '@prisma/client';
import { CategoryDto } from '@snapmarket/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

export function categoryDto(c: Category): CategoryDto {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    icon: c.icon,
    position: c.position,
    isActive: c.isActive,
    requiresReview: c.requiresReview,
  };
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false): Promise<CategoryDto[]> {
    const rows = await this.prisma.category.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    return rows.map(categoryDto);
  }

  async create(dto: CreateCategoryDto, actorId: string): Promise<CategoryDto> {
    const c = await this.prisma.category.create({ data: dto });
    await this.audit.log({
      actorId,
      action: 'category.create',
      entityType: 'Category',
      entityId: c.id,
      metadata: { ...dto },
    });
    return categoryDto(c);
  }

  async update(id: string, dto: UpdateCategoryDto, actorId: string): Promise<CategoryDto> {
    const exists = await this.prisma.category.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Catégorie introuvable');
    const c = await this.prisma.category.update({ where: { id }, data: dto });
    await this.audit.log({
      actorId,
      action: 'category.update',
      entityType: 'Category',
      entityId: id,
      metadata: { ...dto },
    });
    return categoryDto(c);
  }
}
