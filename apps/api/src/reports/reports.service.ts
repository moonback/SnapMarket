import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReportTargetType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CreateReportDto } from './dto/report.dto';

/**
 * Signalements. Règle de masquage automatique : lorsqu'un contenu reçoit un nombre
 * de signalements ouverts distincts égal au seuil configuré, il est masqué en
 * attendant la décision d'un modérateur (les utilisateurs ne sont jamais suspendus
 * automatiquement).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async create(reporterId: string, dto: CreateReportDto): Promise<{ id: string }> {
    await this.assertTargetVisibleTo(reporterId, dto.targetType, dto.targetId);
    const duplicate = await this.prisma.report.findFirst({
      where: {
        reporterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        status: { in: ['OPEN', 'IN_REVIEW'] },
      },
    });
    if (duplicate) throw new ConflictException('Vous avez déjà signalé ce contenu');
    const report = await this.prisma.report.create({
      data: {
        reporterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        details: dto.details ?? null,
      },
    });
    await this.maybeAutoHide(dto.targetType, dto.targetId);
    return { id: report.id };
  }

  private async maybeAutoHide(type: ReportTargetType, id: string): Promise<void> {
    if (type === 'USER') return;
    const { autoHideReportThreshold } = await this.settings.get();
    const distinct = await this.prisma.report.groupBy({
      by: ['reporterId'],
      where: { targetType: type, targetId: id, status: { in: ['OPEN', 'IN_REVIEW'] } },
    });
    if (distinct.length < autoHideReportThreshold) return;
    const data = { moderationStatus: 'HIDDEN' as const };
    const where = { id, moderationStatus: 'VISIBLE' as const };
    let count = 0;
    if (type === 'PRODUCT') count = (await this.prisma.product.updateMany({ where, data })).count;
    if (type === 'STORY') count = (await this.prisma.story.updateMany({ where, data })).count;
    if (type === 'MESSAGE') count = (await this.prisma.message.updateMany({ where, data })).count;
    if (type === 'REVIEW') count = (await this.prisma.review.updateMany({ where, data })).count;
    if (count > 0) {
      await this.audit.log({
        actorId: null,
        action: 'moderation.auto_hide',
        entityType: type,
        entityId: id,
        metadata: { reports: distinct.length, threshold: autoHideReportThreshold },
      });
    }
  }

  /** On ne peut signaler qu'un contenu existant et accessible au signaleur. */
  private async assertTargetVisibleTo(
    userId: string,
    type: ReportTargetType,
    id: string,
  ): Promise<void> {
    const notFound = new NotFoundException('Contenu introuvable');
    switch (type) {
      case 'USER': {
        if (id === userId) throw new BadRequestException('Action impossible');
        if (!(await this.prisma.user.count({ where: { id } }))) throw notFound;
        return;
      }
      case 'PRODUCT': {
        const p = await this.prisma.product.findUnique({ where: { id } });
        if (!p || p.sellerId === userId) throw notFound;
        return;
      }
      case 'STORY': {
        const s = await this.prisma.story.findUnique({ where: { id } });
        if (!s || s.authorId === userId) throw notFound;
        return;
      }
      case 'MESSAGE': {
        const m = await this.prisma.message.findUnique({
          where: { id },
          include: { conversation: { include: { participants: true } } },
        });
        if (
          !m ||
          m.senderId === userId ||
          !m.conversation.participants.some((p) => p.userId === userId)
        ) {
          throw notFound;
        }
        return;
      }
      case 'REVIEW': {
        const r = await this.prisma.review.findUnique({ where: { id } });
        if (!r || r.authorId === userId) throw notFound;
        return;
      }
    }
  }
}
