import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ModerationActionType, ModerationStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

export const MODERATABLE = ['PRODUCT', 'STORY', 'MESSAGE', 'REVIEW'] as const;
export type ModeratableType = (typeof MODERATABLE)[number];
export type ContentAction = 'APPROVE' | 'HIDE' | 'REMOVE' | 'RESTORE';

const ACTION_MAP: Record<ContentAction, { status: ModerationStatus; type: ModerationActionType }> =
  {
    APPROVE: { status: 'VISIBLE', type: 'APPROVE_PRODUCT' },
    HIDE: { status: 'HIDDEN', type: 'HIDE_CONTENT' },
    REMOVE: { status: 'REMOVED', type: 'REMOVE_CONTENT' },
    RESTORE: { status: 'VISIBLE', type: 'RESTORE_CONTENT' },
  };

/** Décisions de modération : chaque action est historisée et journalisée. */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async moderateContent(
    moderatorId: string,
    type: ModeratableType,
    id: string,
    action: ContentAction,
    reason: string | undefined,
    reportId?: string,
  ): Promise<void> {
    const { status, type: actionType } = ACTION_MAP[action];
    const ownerId = await this.prisma.$transaction(async (tx) => {
      const owner = await this.applyStatus(tx, type, id, status);
      await tx.moderationAction.create({
        data: {
          moderatorId,
          action: actionType,
          targetType: type,
          targetId: id,
          reason: reason ?? null,
          reportId: reportId ?? null,
        },
      });
      await this.audit.log(
        {
          actorId: moderatorId,
          action: `moderation.${action.toLowerCase()}`,
          entityType: type,
          entityId: id,
          metadata: { reason: reason ?? null },
        },
        tx,
      );
      return owner;
    });
    if (ownerId && (action === 'HIDE' || action === 'REMOVE')) {
      await this.notifications.notify({
        userId: ownerId,
        type: 'MODERATION',
        title: 'Contenu modéré',
        body: `Un de vos contenus a été ${action === 'REMOVE' ? 'retiré' : 'masqué'} par la modération${reason ? ` : ${reason}` : ''}.`,
        data: { targetType: type, targetId: id },
      });
    }
  }

  private async applyStatus(
    tx: Prisma.TransactionClient,
    type: ModeratableType,
    id: string,
    moderationStatus: ModerationStatus,
  ): Promise<string | null> {
    const nf = new NotFoundException('Contenu introuvable');
    switch (type) {
      case 'PRODUCT': {
        const p = await tx.product.findUnique({ where: { id } });
        if (!p) throw nf;
        await tx.product.update({ where: { id }, data: { moderationStatus } });
        return p.sellerId;
      }
      case 'STORY': {
        const s = await tx.story.findUnique({ where: { id } });
        if (!s) throw nf;
        await tx.story.update({ where: { id }, data: { moderationStatus } });
        return s.authorId;
      }
      case 'MESSAGE': {
        const m = await tx.message.findUnique({ where: { id } });
        if (!m) throw nf;
        await tx.message.update({ where: { id }, data: { moderationStatus } });
        return m.senderId;
      }
      case 'REVIEW': {
        const r = await tx.review.findUnique({ where: { id } });
        if (!r) throw nf;
        if (r.moderationStatus !== moderationStatus) {
          // Les agrégats de notes ne comptent que les avis visibles.
          const delta =
            moderationStatus === 'VISIBLE' ? 1 : r.moderationStatus === 'VISIBLE' ? -1 : 0;
          if (delta !== 0) {
            await tx.user.update({
              where: { id: r.subjectId },
              data: {
                ratingCount: { increment: delta },
                ratingSum: { increment: delta * r.rating },
              },
            });
          }
        }
        await tx.review.update({ where: { id }, data: { moderationStatus } });
        return r.authorId;
      }
      default:
        throw new BadRequestException('Type de contenu invalide');
    }
  }
}
