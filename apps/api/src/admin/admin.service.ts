import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/auth.decorators';
import { ModerationService } from '../moderation/moderation.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ORDER_INCLUDE, OrdersService } from '../orders/orders.service';
import { OrderStateService } from '../orders/order-state.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  sellerProfileDto,
  USER_SUMMARY_INCLUDE,
  UserPresenter,
} from '../users/user-presenter.service';
import {
  AdminOrdersQuery,
  AdminProductsQuery,
  AdminUsersQuery,
  AuditQuery,
  ContentModerationDto,
  DisputesQuery,
  PageQueryDto,
  ReportsQuery,
  ResolveDisputeDto,
  ResolveReportDto,
  SellerDecisionDto,
  SellersQuery,
  UserRoleDto,
  UserStatusDto,
} from './dto/admin.dto';

function paging(q: PageQueryDto) {
  const pageSize = q.pageSize ?? 25;
  const page = q.page ?? 1;
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly moderation: ModerationService,
    private readonly notifications: NotificationsService,
    private readonly orders: OrdersService,
    private readonly orderState: OrderStateService,
    private readonly presenter: UserPresenter,
  ) {}

  async dashboard() {
    const [
      users,
      activeProducts,
      ordersByStatus,
      openReports,
      openDisputes,
      pendingSellers,
      gmv,
      commission,
      failedTransfers,
      webhookErrors,
    ] = await Promise.all([
      this.prisma.user.count({ where: { status: { not: 'DELETED' } } }),
      this.prisma.product.count({
        where: { status: 'ACTIVE', moderationStatus: 'VISIBLE', deletedAt: null },
      }),
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.report.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } } }),
      this.prisma.dispute.count({ where: { status: 'OPEN' } }),
      this.prisma.sellerProfile.count({ where: { verificationStatus: 'PENDING' } }),
      this.prisma.order.aggregate({ where: { status: 'COMPLETED' }, _sum: { totalCents: true } }),
      // Commission effectivement retenue (enregistrée uniquement après transfert réussi).
      this.prisma.ledgerEntry.aggregate({
        where: { type: 'COMMISSION' },
        _sum: { amountCents: true },
      }),
      this.prisma.order.count({ where: { transferStatus: 'FAILED' } }),
      this.prisma.paymentEvent.count({ where: { processedAt: null, error: { not: null } } }),
    ]);
    return {
      users,
      activeProducts,
      ordersByStatus: Object.fromEntries(ordersByStatus.map((g) => [g.status, g._count._all])),
      openReports,
      openDisputes,
      pendingSellers,
      completedGmvCents: gmv._sum.totalCents ?? 0,
      retainedCommissionCents: commission._sum.amountCents ?? 0,
      failedTransfers,
      webhookErrors,
    };
  }

  // ---------------------------------------------------------------- Utilisateurs

  async users(q: AdminUsersQuery) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.UserWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.role ? { role: q.role } : {}),
      ...(q.q
        ? {
            OR: [
              { email: { contains: q.q, mode: 'insensitive' } },
              { username: { contains: q.q, mode: 'insensitive' } },
              { id: q.q },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { sellerProfile: true },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        role: u.role,
        status: u.status,
        emailVerified: u.emailVerifiedAt !== null,
        createdAt: u.createdAt.toISOString(),
        seller: sellerProfileDto(u.sellerProfile),
        rating: { count: u.ratingCount, sum: u.ratingSum },
      })),
    };
  }

  async userDetail(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: { sellerProfile: true },
    });
    if (!u) throw new NotFoundException('Utilisateur introuvable');
    const [products, purchases, sales, reportsAgainst, moderation] = await Promise.all([
      this.prisma.product.count({ where: { sellerId: id, deletedAt: null } }),
      this.prisma.order.count({ where: { buyerId: id } }),
      this.prisma.order.count({ where: { sellerId: id } }),
      this.prisma.report.count({ where: { targetType: 'USER', targetId: id } }),
      this.prisma.moderationAction.findMany({
        where: { targetId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      status: u.status,
      emailVerified: u.emailVerifiedAt !== null,
      createdAt: u.createdAt.toISOString(),
      lockedUntil: u.lockedUntil?.toISOString() ?? null,
      seller: sellerProfileDto(u.sellerProfile),
      sellerLegal: u.sellerProfile
        ? {
            legalAddress: u.sellerProfile.legalAddress,
            verificationNote: u.sellerProfile.verificationNote,
          }
        : null,
      counts: { products, purchases, sales, reportsAgainst },
      moderationHistory: moderation,
    };
  }

  async setUserStatus(actor: AuthUser, id: string, dto: UserStatusDto) {
    if (id === actor.id)
      throw new BadRequestException('Vous ne pouvez pas modifier votre propre statut');
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || target.status === 'DELETED')
      throw new NotFoundException('Utilisateur introuvable');
    if (target.role === 'ADMIN' || (target.role === 'MODERATOR' && actor.role !== 'ADMIN')) {
      throw new ForbiddenException('Droits insuffisants sur ce compte');
    }
    const actionType =
      dto.status === 'ACTIVE'
        ? 'REACTIVATE_USER'
        : dto.status === 'SUSPENDED'
          ? 'SUSPEND_USER'
          : 'BAN_USER';
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: dto.status } });
      if (dto.status !== 'ACTIVE') {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.moderationAction.create({
        data: {
          moderatorId: actor.id,
          action: actionType,
          targetType: 'USER',
          targetId: id,
          reason: dto.reason ?? null,
        },
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'admin.user_status',
          entityType: 'User',
          entityId: id,
          metadata: { from: target.status, to: dto.status, reason: dto.reason ?? null },
        },
        tx,
      );
    });
    return this.userDetail(id);
  }

  /** Attribution des rôles USER / MODERATOR. Le rôle ADMIN n'est jamais attribuable par l'API. */
  async setUserRole(actor: AuthUser, id: string, dto: UserRoleDto) {
    if (id === actor.id)
      throw new BadRequestException('Vous ne pouvez pas modifier votre propre rôle');
    const target = await this.prisma.user.findUnique({
      where: { id },
      include: { sellerProfile: true },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable');
    if (target.role === 'ADMIN')
      throw new ForbiddenException('Le rôle administrateur se gère par la procédure CLI');
    let role: typeof dto.role | 'PRO_SELLER' = dto.role;
    // Un vendeur pro vérifié qui perd le rôle modérateur redevient PRO_SELLER.
    if (
      dto.role === 'USER' &&
      target.sellerProfile?.verificationStatus === 'VERIFIED' &&
      target.sellerProfile.accountType === 'PROFESSIONAL'
    ) {
      role = 'PRO_SELLER';
    }
    await this.prisma.user.update({ where: { id }, data: { role } });
    await this.audit.log({
      actorId: actor.id,
      action: 'admin.user_role',
      entityType: 'User',
      entityId: id,
      metadata: { from: target.role, to: role },
    });
    return this.userDetail(id);
  }

  // ---------------------------------------------------------------- Vendeurs

  async sellers(q: SellersQuery) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.SellerProfileWhereInput = {
      ...(q.verificationStatus
        ? { verificationStatus: q.verificationStatus }
        : { accountType: 'PROFESSIONAL' }),
      ...(q.q
        ? {
            OR: [
              { companyName: { contains: q.q, mode: 'insensitive' } },
              { siret: { contains: q.q } },
              { user: { username: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.sellerProfile.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: { user: { select: { id: true, username: true, email: true, status: true } } },
      }),
      this.prisma.sellerProfile.count({ where }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((s) => ({
        user: s.user,
        ...sellerProfileDto(s)!,
        legalAddress: s.legalAddress,
        verificationNote: s.verificationNote,
        stripeAccountId: s.stripeAccountId,
        updatedAt: s.updatedAt.toISOString(),
      })),
    };
  }

  /**
   * Décision de vérification d'un vendeur professionnel, prise par un membre de l'équipe
   * après contrôle des justificatifs (ex. extrait Kbis / registre INSEE) hors application.
   */
  async decideSeller(actor: AuthUser, userId: string, dto: SellerDecisionDto) {
    const profile = await this.prisma.sellerProfile.findUnique({
      where: { userId },
      include: { user: true },
    });
    if (!profile || profile.accountType !== 'PROFESSIONAL')
      throw new NotFoundException('Demande introuvable');
    if (profile.verificationStatus !== 'PENDING' && dto.decision === 'VERIFIED') {
      throw new ConflictException('Aucune demande en attente');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.sellerProfile.update({
        where: { userId },
        data: {
          verificationStatus: dto.decision,
          verificationNote: dto.note ?? null,
          verifiedAt: dto.decision === 'VERIFIED' ? new Date() : null,
          verifiedById: actor.id,
        },
      });
      if (profile.user.role === 'USER' || profile.user.role === 'PRO_SELLER') {
        await tx.user.update({
          where: { id: userId },
          data: { role: dto.decision === 'VERIFIED' ? 'PRO_SELLER' : 'USER' },
        });
      }
      await tx.moderationAction.create({
        data: {
          moderatorId: actor.id,
          action: dto.decision === 'VERIFIED' ? 'VERIFY_SELLER' : 'REJECT_SELLER',
          targetType: 'USER',
          targetId: userId,
          reason: dto.note ?? null,
        },
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'admin.seller_decision',
          entityType: 'SellerProfile',
          entityId: profile.id,
          metadata: { decision: dto.decision },
        },
        tx,
      );
    });
    await this.notifications.notify({
      userId,
      type: 'SYSTEM',
      title:
        dto.decision === 'VERIFIED'
          ? 'Statut professionnel vérifié'
          : 'Demande professionnelle refusée',
      body:
        dto.note ??
        (dto.decision === 'VERIFIED'
          ? 'Votre compte professionnel est vérifié.'
          : 'Consultez votre profil vendeur.'),
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------- Contenus

  async products(q: AdminProductsQuery) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(q.moderationStatus ? { moderationStatus: q.moderationStatus } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { id: q.q }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          seller: { select: { id: true, username: true } },
          category: { select: { name: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((p) => ({
        id: p.id,
        title: p.title,
        priceCents: p.priceCents,
        status: p.status,
        moderationStatus: p.moderationStatus,
        category: p.category.name,
        seller: p.seller,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  async flaggedMessages(q: PageQueryDto) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.MessageWhereInput = { flaggedAsSpam: true, moderationStatus: 'VISIBLE' };
    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { sender: { select: { id: true, username: true } } },
      }),
      this.prisma.message.count({ where }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((m) => ({
        id: m.id,
        body: m.body,
        sender: m.sender,
        conversationId: m.conversationId,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  moderate(
    actor: AuthUser,
    type: 'PRODUCT' | 'STORY' | 'MESSAGE' | 'REVIEW',
    id: string,
    dto: ContentModerationDto,
  ) {
    return this.moderation.moderateContent(actor.id, type, id, dto.action, dto.reason);
  }

  // ---------------------------------------------------------------- Commandes

  async orderList(q: AdminOrdersQuery) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.OrderWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ reference: { contains: q.q.toUpperCase() } }, { id: q.q }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          buyer: { select: { id: true, username: true } },
          seller: { select: { id: true, username: true } },
          product: { select: { id: true, title: true } },
          payment: { select: { status: true, providerPaymentIntentId: true, refundedCents: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((o) => ({
        id: o.id,
        reference: o.reference,
        status: o.status,
        deliveryMode: o.deliveryMode,
        totalCents: o.totalCents,
        commissionCents: o.commissionCents,
        transferStatus: o.transferStatus,
        payment: o.payment,
        buyer: o.buyer,
        seller: o.seller,
        product: o.product,
        createdAt: o.createdAt.toISOString(),
      })),
    };
  }

  async orderDetail(actor: AuthUser, id: string) {
    const order = await this.orders.get(actor, id);
    const [ledger, events] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.paymentEvent.findMany({
        where: { orderId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          providerEventId: true,
          type: true,
          processedAt: true,
          error: true,
          createdAt: true,
        },
      }),
    ]);
    return { order, ledger, paymentEvents: events };
  }

  async refundOrder(actor: AuthUser, id: string, reason: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Commande introuvable');
    await this.orders.refundAndClose(order, 'ADMIN', actor.id, reason);
    await this.audit.log({
      actorId: actor.id,
      action: 'admin.order_refund',
      entityType: 'Order',
      entityId: id,
      metadata: { reason },
    });
    return this.orderDetail(actor, id);
  }

  // ---------------------------------------------------------------- Litiges

  async disputes(q: DisputesQuery) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.DisputeWhereInput = q.status ? { status: q.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            select: {
              id: true,
              reference: true,
              status: true,
              totalCents: true,
              deliveryMode: true,
            },
          },
        },
      }),
      this.prisma.dispute.count({ where }),
    ]);
    return { total, page, pageSize, items: rows };
  }

  async resolveDispute(actor: AuthUser, disputeId: string, dto: ResolveDisputeDto) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { order: { include: ORDER_INCLUDE } },
    });
    if (!dispute) throw new NotFoundException('Litige introuvable');
    if (dispute.status !== 'OPEN') throw new ConflictException('Ce litige est déjà résolu');
    if (dto.resolution === 'REFUND') {
      await this.orders.refundAndClose(
        dispute.order,
        'ADMIN',
        actor.id,
        `Litige résolu : ${dto.note}`,
      );
    } else {
      await this.orderState.transition({
        orderId: dispute.orderId,
        to: 'COMPLETED',
        actor: 'ADMIN',
        actorId: actor.id,
        note: `Litige résolu en faveur du vendeur : ${dto.note}`,
        expectedFrom: 'DISPUTED',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: dto.resolution === 'REFUND' ? 'RESOLVED_REFUND' : 'RESOLVED_RELEASE',
          resolutionNote: dto.note,
          resolvedById: actor.id,
          resolvedAt: new Date(),
        },
      });
      await tx.moderationAction.create({
        data: {
          moderatorId: actor.id,
          action: 'RESOLVE_DISPUTE',
          targetType: 'ORDER',
          targetId: dispute.orderId,
          reason: `${dto.resolution}: ${dto.note}`,
        },
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'admin.dispute_resolve',
          entityType: 'Dispute',
          entityId: disputeId,
          metadata: { resolution: dto.resolution },
        },
        tx,
      );
    });
    return this.prisma.dispute.findUniqueOrThrow({ where: { id: disputeId } });
  }

  // ---------------------------------------------------------------- Signalements

  async reports(q: ReportsQuery) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.ReportWhereInput = {
      ...(q.status ? { status: q.status } : { status: { in: ['OPEN', 'IN_REVIEW'] } }),
      ...(q.targetType ? { targetType: q.targetType } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'asc' },
        include: { reporter: { include: USER_SUMMARY_INCLUDE } },
      }),
      this.prisma.report.count({ where }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: await Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          targetType: r.targetType,
          targetId: r.targetId,
          reason: r.reason,
          details: r.details,
          status: r.status,
          resolutionNote: r.resolutionNote,
          reporter: await this.presenter.summary(r.reporter),
          createdAt: r.createdAt.toISOString(),
          target: await this.reportTarget(r.targetType, r.targetId),
        })),
      ),
    };
  }

  private async reportTarget(type: string, id: string): Promise<Record<string, unknown> | null> {
    switch (type) {
      case 'PRODUCT': {
        const p = await this.prisma.product.findUnique({
          where: { id },
          select: {
            id: true,
            title: true,
            description: true,
            moderationStatus: true,
            sellerId: true,
          },
        });
        return p;
      }
      case 'STORY':
        return this.prisma.story.findUnique({
          where: { id },
          select: { id: true, caption: true, moderationStatus: true, authorId: true },
        });
      case 'MESSAGE':
        return this.prisma.message.findUnique({
          where: { id },
          select: { id: true, body: true, moderationStatus: true, senderId: true },
        });
      case 'REVIEW':
        return this.prisma.review.findUnique({
          where: { id },
          select: { id: true, rating: true, comment: true, moderationStatus: true, authorId: true },
        });
      case 'USER':
        return this.prisma.user.findUnique({
          where: { id },
          select: { id: true, username: true, status: true },
        });
      default:
        return null;
    }
  }

  async resolveReport(actor: AuthUser, id: string, dto: ResolveReportDto) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Signalement introuvable');
    if (report.status === 'RESOLVED' || report.status === 'DISMISSED')
      throw new ConflictException('Signalement déjà traité');
    if (dto.contentAction) {
      if (report.targetType === 'USER')
        throw new BadRequestException('Utilisez la gestion des utilisateurs pour un compte');
      await this.moderation.moderateContent(
        actor.id,
        report.targetType,
        report.targetId,
        dto.contentAction,
        dto.note,
        report.id,
      );
    }
    // Les autres signalements ouverts sur le même contenu sont clos avec la même décision.
    const res = await this.prisma.report.updateMany({
      where: {
        targetType: report.targetType,
        targetId: report.targetId,
        status: { in: ['OPEN', 'IN_REVIEW'] },
      },
      data: {
        status: dto.status,
        handledById: actor.id,
        handledAt: new Date(),
        resolutionNote: dto.note ?? null,
      },
    });
    await this.prisma.moderationAction.create({
      data: {
        moderatorId: actor.id,
        action: dto.status === 'RESOLVED' ? 'RESOLVE_REPORT' : 'DISMISS_REPORT',
        targetType: report.targetType,
        targetId: report.targetId,
        reason: dto.note ?? null,
        reportId: report.id,
      },
    });
    // Un contenu masqué automatiquement puis classé sans suite redevient visible.
    const target = await this.reportTarget(report.targetType, report.targetId);
    if (
      dto.status === 'DISMISSED' &&
      report.targetType !== 'USER' &&
      target?.moderationStatus === 'HIDDEN'
    ) {
      await this.moderation.moderateContent(
        actor.id,
        report.targetType,
        report.targetId,
        'RESTORE',
        'Signalement classé sans suite',
        report.id,
      );
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'admin.report_resolve',
      entityType: 'Report',
      entityId: id,
      metadata: { status: dto.status, closed: res.count },
    });
    return { closed: res.count };
  }

  // ---------------------------------------------------------------- Audit

  async auditLogs(q: AuditQuery) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { id: true, username: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { total, page, pageSize, items: rows };
  }
}
