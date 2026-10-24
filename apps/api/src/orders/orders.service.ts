import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Order, Prisma } from '@prisma/client';
import {
  AddressDto as AddressContract,
  allowedOrderTransitions,
  CheckoutSession,
  OrderActor,
  OrderDto,
  Paginated,
  PENDING_PAYMENT_EXPIRY_MINUTES,
} from '@snapmarket/shared';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/auth.decorators';
import { orderReference } from '../common/utils/crypto';
import { decodeCursor, pageSize, paginate } from '../common/utils/pagination';
import { MediaService } from '../media/media.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { USER_SUMMARY_INCLUDE, UserPresenter } from '../users/user-presenter.service';
import { UsersService } from '../users/users.service';
import { CreateOrderDto, DisputeDto, ListOrdersDto, ShipOrderDto } from './dto/order.dto';
import { OrderStateService, reserveStock } from './order-state.service';
import { computeOrderPricing } from './pricing';

const MAX_PENDING_ORDERS_PER_BUYER = 5;

export const ORDER_INCLUDE = {
  buyer: { include: USER_SUMMARY_INCLUDE },
  seller: { include: USER_SUMMARY_INCLUDE },
  product: {
    include: {
      media: { include: { media: true }, orderBy: { position: 'asc' as const }, take: 1 },
    },
  },
  payment: true,
  shipment: { include: { events: { orderBy: { createdAt: 'asc' as const } } } },
  meetups: { orderBy: { createdAt: 'desc' as const } },
  statusEvents: { orderBy: { createdAt: 'asc' as const } },
  dispute: true,
  reviews: { select: { authorId: true } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly state: OrderStateService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly presenter: UserPresenter,
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Création et paiement
  // ------------------------------------------------------------------

  async create(user: AuthUser, dto: CreateOrderDto): Promise<CheckoutSession> {
    if (!this.payments.available) {
      throw new ServiceUnavailableException({
        message: 'Le paiement en ligne n’est pas encore disponible',
        code: 'PAYMENTS_UNAVAILABLE',
      });
    }
    // Le vendeur et le prix sont toujours déterminés côté serveur à partir de l'annonce.
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { seller: { include: { sellerProfile: true } } },
    });
    if (!product || product.deletedAt) throw new NotFoundException('Annonce introuvable');
    if (product.sellerId === user.id)
      throw new BadRequestException('Vous ne pouvez pas acheter votre propre annonce');
    if (product.seller.status !== 'ACTIVE')
      throw new ConflictException('Ce vendeur n’est plus actif');
    if (await this.users.isBlockedBetween(user.id, product.sellerId)) {
      throw new ForbiddenException('Achat impossible auprès de ce vendeur');
    }
    if (!product.deliveryModes.includes(dto.deliveryMode)) {
      throw new BadRequestException('Mode de livraison non proposé pour cette annonce');
    }
    if (dto.deliveryMode === 'SHIPPING' && !dto.shippingAddress) {
      throw new BadRequestException('Adresse de livraison requise');
    }
    if (
      !product.seller.sellerProfile?.stripePayoutsEnabled ||
      !product.seller.sellerProfile.stripeAccountId
    ) {
      throw new ConflictException({
        message: 'Le vendeur n’a pas encore activé la réception des paiements',
        code: 'SELLER_PAYOUTS_NOT_READY',
      });
    }
    const pending = await this.prisma.order.count({
      where: { buyerId: user.id, status: 'PENDING_PAYMENT' },
    });
    if (pending >= MAX_PENDING_ORDERS_PER_BUYER) {
      throw new HttpException(
        'Trop de commandes en attente de paiement',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let quantity = dto.quantity ?? 1;
    let unitPriceCents = product.priceCents;
    if (dto.offerId) {
      const offer = await this.prisma.offer.findUnique({ where: { id: dto.offerId } });
      if (
        !offer ||
        offer.buyerId !== user.id ||
        offer.productId !== product.id ||
        offer.status !== 'ACCEPTED' ||
        (offer.expiresAt && offer.expiresAt < new Date())
      ) {
        throw new BadRequestException('Offre invalide ou expirée');
      }
      quantity = 1;
      unitPriceCents = offer.amountCents;
    }
    const { commissionBps } = await this.settings.get();
    const pricing = computeOrderPricing({
      unitPriceCents,
      quantity,
      shippingFeeCents: dto.deliveryMode === 'SHIPPING' ? (product.shippingFeeCents ?? 0) : 0,
      commissionBps,
    });

    const order = await this.prisma.$transaction(async (tx) => {
      if (!(await reserveStock(tx, product.id, quantity))) {
        throw new ConflictException({
          message: 'Cet article n’est plus disponible',
          code: 'PRODUCT_UNAVAILABLE',
        });
      }
      if (dto.offerId) {
        const used = await tx.offer.updateMany({
          where: { id: dto.offerId, status: 'ACCEPTED' },
          data: { status: 'USED' },
        });
        if (used.count !== 1) throw new ConflictException('Offre déjà utilisée');
      }
      const created = await tx.order.create({
        data: {
          reference: orderReference(),
          buyerId: user.id,
          sellerId: product.sellerId,
          productId: product.id,
          offerId: dto.offerId ?? null,
          quantity,
          deliveryMode: dto.deliveryMode,
          unitPriceCents,
          itemPriceCents: pricing.itemPriceCents,
          shippingFeeCents: pricing.shippingFeeCents,
          totalCents: pricing.totalCents,
          commissionBps: pricing.commissionBps,
          commissionCents: pricing.commissionCents,
          sellerPayoutCents: pricing.sellerPayoutCents,
          shippingAddress:
            dto.deliveryMode === 'SHIPPING'
              ? (dto.shippingAddress as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          paymentExpiresAt: new Date(Date.now() + PENDING_PAYMENT_EXPIRY_MINUTES * 60_000),
        },
      });
      await tx.orderStatusEvent.create({
        data: {
          orderId: created.id,
          from: null,
          to: 'PENDING_PAYMENT',
          actorType: 'BUYER',
          actorId: user.id,
        },
      });
      await this.audit.log(
        {
          actorId: user.id,
          action: 'order.create',
          entityType: 'Order',
          entityId: created.id,
          metadata: { ...pricing, quantity },
        },
        tx,
      );
      return created;
    });

    let clientSecret: string;
    try {
      clientSecret = await this.payments.createPaymentIntent(order);
    } catch (e) {
      this.logger.error(`Création du paiement impossible pour ${order.id} : ${String(e)}`);
      await this.state.transition({
        orderId: order.id,
        to: 'CANCELLED',
        actor: 'SYSTEM',
        actorId: null,
        note: 'Échec de l’initialisation du paiement',
      });
      throw new BadGatewayException('Le paiement n’a pas pu être initialisé, réessayez plus tard');
    }
    return {
      order: await this.get(user, order.id),
      paymentClientSecret: clientSecret,
      publishableKeyRequired: true,
    };
  }

  async paymentSession(user: AuthUser, id: string): Promise<CheckoutSession> {
    const order = await this.loadFor(user, id);
    if (order.buyerId !== user.id) throw new ForbiddenException('Accès refusé');
    if (order.status !== 'PENDING_PAYMENT')
      throw new ConflictException('Cette commande n’attend plus de paiement');
    const clientSecret = await this.payments.clientSecret(order.id);
    return {
      order: await this.toDto(order, user),
      paymentClientSecret: clientSecret,
      publishableKeyRequired: true,
    };
  }

  // ------------------------------------------------------------------
  // Lecture
  // ------------------------------------------------------------------

  async get(user: AuthUser, id: string): Promise<OrderDto> {
    return this.toDto(await this.loadFor(user, id), user);
  }

  async list(user: AuthUser, query: ListOrdersDto): Promise<Paginated<OrderDto>> {
    const limit = pageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.order.findMany({
      where: {
        ...(query.role === 'buyer' ? { buyerId: user.id } : { sellerId: user.id }),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(String(cursor.v)) } },
                { createdAt: new Date(String(cursor.v)), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: ORDER_INCLUDE,
    });
    const page = paginate(rows, limit, (o) => ({ v: o.createdAt.toISOString(), id: o.id }));
    return {
      items: await Promise.all(page.items.map((o) => this.toDto(o, user))),
      nextCursor: page.nextCursor,
    };
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  async cancel(user: AuthUser, id: string, reason?: string): Promise<OrderDto> {
    const order = await this.loadFor(user, id);
    const actor = this.actorOf(order, user);
    if (order.status === 'PENDING_PAYMENT') {
      await this.payments.cancelPaymentIntent(order.id);
      await this.state.transition({
        orderId: order.id,
        to: 'CANCELLED',
        actor,
        actorId: user.id,
        note: reason,
      });
    } else if (['PAID', 'PREPARING', 'READY_FOR_HANDOFF'].includes(order.status)) {
      if (actor === 'BUYER') {
        throw new ForbiddenException(
          'Après paiement, l’annulation doit être faite par le vendeur ou via un signalement de problème',
        );
      }
      await this.refundAndClose(order, actor, user.id, reason ?? 'Annulation par le vendeur');
    } else {
      throw new ConflictException('Cette commande ne peut plus être annulée');
    }
    return this.get(user, id);
  }

  /** Remboursement intégral puis passage à REFUNDED (vendeur ou administrateur). */
  async refundAndClose(
    order: Order,
    actor: OrderActor,
    actorId: string,
    reason: string,
  ): Promise<void> {
    // Vérification de la transition avant tout appel au prestataire.
    const allowed = allowedOrderTransitions(order.status, actor, order.deliveryMode);
    if (!allowed.includes('REFUNDED'))
      throw new ConflictException('Remboursement impossible dans cet état');
    const refundId = await this.payments.refundInFull(order, reason);
    await this.state.transition({
      orderId: order.id,
      to: 'REFUNDED',
      actor,
      actorId,
      note: `${reason} (remboursement ${refundId})`,
      expectedFrom: order.status,
    });
    await this.prisma.meetup.updateMany({
      where: { orderId: order.id, status: { in: ['PROPOSED', 'ACCEPTED'] } },
      data: { status: 'CANCELLED' },
    });
  }

  async markPreparing(user: AuthUser, id: string): Promise<OrderDto> {
    const order = await this.loadFor(user, id);
    this.assertSeller(order, user);
    await this.state.transition({
      orderId: id,
      to: 'PREPARING',
      actor: 'SELLER',
      actorId: user.id,
      expectedFrom: 'PAID',
    });
    return this.get(user, id);
  }

  /**
   * Déclaration d'expédition par le vendeur. Aucun transporteur n'est intégré : les
   * informations de suivi sont celles saisies par le vendeur, aucune étiquette n'est générée.
   */
  async ship(user: AuthUser, id: string, dto: ShipOrderDto): Promise<OrderDto> {
    const order = await this.loadFor(user, id);
    this.assertSeller(order, user);
    await this.state.transition({
      orderId: id,
      to: 'SHIPPED',
      actor: 'SELLER',
      actorId: user.id,
      expectedFrom: 'PREPARING',
      extra: async (tx) => {
        const shipment = await tx.shipment.upsert({
          where: { orderId: id },
          create: {
            orderId: id,
            carrier: dto.carrier ?? null,
            trackingNumber: dto.trackingNumber ?? null,
            trackingUrl: dto.trackingUrl ?? null,
            shippedAt: new Date(),
          },
          update: {
            carrier: dto.carrier ?? null,
            trackingNumber: dto.trackingNumber ?? null,
            trackingUrl: dto.trackingUrl ?? null,
            shippedAt: new Date(),
          },
        });
        await tx.shipmentEvent.create({
          data: {
            shipmentId: shipment.id,
            status: 'SHIPPED',
            note: 'Expédition déclarée par le vendeur',
          },
        });
      },
    });
    return this.get(user, id);
  }

  /** L'acheteur confirme la réception (livraison) ou la remise (main propre). */
  async confirm(user: AuthUser, id: string): Promise<OrderDto> {
    const order = await this.loadFor(user, id);
    if (order.buyerId !== user.id)
      throw new ForbiddenException('Seul l’acheteur peut confirmer la réception');
    const from = order.deliveryMode === 'SHIPPING' ? 'SHIPPED' : 'READY_FOR_HANDOFF';
    await this.state.transition({
      orderId: id,
      to: 'COMPLETED',
      actor: 'BUYER',
      actorId: user.id,
      expectedFrom: from,
      note:
        order.deliveryMode === 'SHIPPING'
          ? 'Réception confirmée'
          : 'Remise en main propre confirmée',
      extra: async (tx) => {
        if (order.deliveryMode === 'MEETUP') {
          await tx.meetup.updateMany({
            where: { orderId: id, status: 'ACCEPTED' },
            data: { status: 'COMPLETED' },
          });
        } else if (order.shipment) {
          await tx.shipmentEvent.create({
            data: {
              shipmentId: order.shipment.id,
              status: 'DELIVERED',
              note: 'Réception confirmée par l’acheteur',
            },
          });
        }
      },
    });
    return this.get(user, id);
  }

  async openDispute(user: AuthUser, id: string, dto: DisputeDto): Promise<OrderDto> {
    const order = await this.loadFor(user, id);
    if (order.buyerId !== user.id)
      throw new ForbiddenException('Seul l’acheteur peut signaler un problème');
    await this.state.transition({
      orderId: id,
      to: 'DISPUTED',
      actor: 'BUYER',
      actorId: user.id,
      note: dto.reason,
      extra: async (tx) => {
        await tx.dispute.upsert({
          where: { orderId: id },
          create: {
            orderId: id,
            openedById: user.id,
            reason: dto.reason,
            details: dto.details ?? null,
          },
          update: { reason: dto.reason, details: dto.details ?? null, status: 'OPEN' },
        });
      },
    });
    return this.get(user, id);
  }

  /** Tâche planifiée : annule les commandes jamais payées après le délai imparti. */
  async expireUnpaid(now = new Date()): Promise<number> {
    const expired = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', paymentExpiresAt: { lt: now } },
      select: { id: true },
      take: 200,
    });
    let count = 0;
    for (const { id } of expired) {
      try {
        await this.payments.cancelPaymentIntent(id);
        await this.state.transition({
          orderId: id,
          to: 'CANCELLED',
          actor: 'SYSTEM',
          actorId: null,
          note: 'Délai de paiement dépassé',
          expectedFrom: 'PENDING_PAYMENT',
        });
        count++;
      } catch (e) {
        this.logger.warn(`Expiration de la commande ${id} impossible : ${String(e)}`);
      }
    }
    return count;
  }

  // ------------------------------------------------------------------
  // Utilitaires
  // ------------------------------------------------------------------

  async loadFor(user: AuthUser, id: string): Promise<OrderRow> {
    const order = await this.prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    const staff = user.role === 'ADMIN' || user.role === 'MODERATOR';
    if (!order || (order.buyerId !== user.id && order.sellerId !== user.id && !staff)) {
      throw new NotFoundException('Commande introuvable');
    }
    return order;
  }

  actorOf(order: Pick<Order, 'buyerId' | 'sellerId'>, user: AuthUser): OrderActor {
    if (order.buyerId === user.id) return 'BUYER';
    if (order.sellerId === user.id) return 'SELLER';
    if (user.role === 'ADMIN') return 'ADMIN';
    throw new ForbiddenException('Accès refusé');
  }

  private assertSeller(order: Order, user: AuthUser): void {
    if (order.sellerId !== user.id) throw new ForbiddenException('Action réservée au vendeur');
  }

  async toDto(o: OrderRow, viewer: AuthUser): Promise<OrderDto> {
    const role: OrderDto['role'] =
      o.buyerId === viewer.id ? 'BUYER' : o.sellerId === viewer.id ? 'SELLER' : 'ADMIN';
    const actor: OrderActor = role;
    const cover = o.product.media[0]?.media;
    const address = o.shippingAddress as unknown as AddressContract | null;
    // L'adresse n'est visible que des parties à la transaction et de l'administration.
    return {
      id: o.id,
      reference: o.reference,
      status: o.status,
      deliveryMode: o.deliveryMode,
      role,
      product: {
        id: o.product.id,
        title: o.product.title,
        cover: cover ? await this.media.toDto(cover) : null,
      },
      buyer: await this.presenter.summary(o.buyer),
      seller: await this.presenter.summary(o.seller),
      quantity: o.quantity,
      pricing: {
        itemPriceCents: o.itemPriceCents,
        shippingFeeCents: o.shippingFeeCents,
        totalCents: o.totalCents,
        commissionCents: o.commissionCents,
        commissionBps: o.commissionBps,
        sellerPayoutCents: o.sellerPayoutCents,
      },
      paymentStatus: o.payment?.status ?? null,
      transferStatus: o.transferStatus,
      shippingAddress: address
        ? {
            fullName: address.fullName,
            line1: address.line1,
            line2: address.line2 ?? null,
            postalCode: address.postalCode,
            city: address.city,
            country: 'FR',
            phone: address.phone ?? null,
          }
        : null,
      shipment: o.shipment
        ? {
            carrier: o.shipment.carrier,
            trackingNumber: o.shipment.trackingNumber,
            trackingUrl: o.shipment.trackingUrl,
            shippedAt: o.shipment.shippedAt?.toISOString() ?? null,
            events: o.shipment.events.map((e) => ({
              status: e.status,
              note: e.note,
              createdAt: e.createdAt.toISOString(),
            })),
          }
        : null,
      meetups: o.meetups.map((m) => ({
        id: m.id,
        proposedById: m.proposedById,
        scheduledAt: m.scheduledAt.toISOString(),
        locationLabel: m.locationLabel,
        notes: m.notes,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
      })),
      history: o.statusEvents.map((e) => ({
        from: e.from,
        to: e.to,
        actor: e.actorType,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
      allowedTransitions: allowedOrderTransitions(o.status, actor, o.deliveryMode),
      canReview:
        o.status === 'COMPLETED' &&
        role !== 'ADMIN' &&
        !o.reviews.some((r) => r.authorId === viewer.id),
      dispute: o.dispute
        ? { id: o.dispute.id, status: o.dispute.status, reason: o.dispute.reason }
        : null,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    };
  }
}
