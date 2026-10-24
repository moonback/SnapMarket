import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Order, Prisma } from '@prisma/client';
import {
  AddressDto as AddressContract,
  allowedOrderTransitions,
  CheckoutDto,
  CheckoutSession,
  OrderActor,
  OrderDto,
  Paginated,
} from '@snapmarket/shared';
import { AuthUser } from '../common/decorators/auth.decorators';
import { decodeCursor, pageSize, paginate } from '../common/utils/pagination';
import { MediaService } from '../media/media.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { USER_SUMMARY_INCLUDE, UserPresenter } from '../users/user-presenter.service';
import { CreateOrderDto, DisputeDto, ListOrdersDto, ShipOrderDto } from './dto/order.dto';
import { CheckoutService } from './checkout.service';
import { OrderStateService } from './order-state.service';

export const ORDER_INCLUDE = {
  buyer: { include: USER_SUMMARY_INCLUDE },
  seller: { include: USER_SUMMARY_INCLUDE },
  product: {
    include: {
      media: { include: { media: true }, orderBy: { position: 'asc' as const }, take: 1 },
    },
  },
  checkout: { include: { payment: true, _count: { select: { orders: true } } } },
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
    private readonly presenter: UserPresenter,
    private readonly media: MediaService,
    private readonly checkouts: CheckoutService,
  ) {}

  // ------------------------------------------------------------------
  // Création et paiement
  // ------------------------------------------------------------------

  /** Achat direct d'une annonce : paiement groupé d'une seule commande. */
  async create(user: AuthUser, dto: CreateOrderDto): Promise<CheckoutSession> {
    const { checkout, clientSecret } = await this.checkouts.create(
      user,
      [
        {
          productId: dto.productId,
          quantity: dto.quantity ?? 1,
          deliveryMode: dto.deliveryMode,
          offerId: dto.offerId,
        },
      ],
      dto.shippingAddress,
    );
    const order = await this.prisma.order.findFirstOrThrow({ where: { checkoutId: checkout.id } });
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
    // Le paiement couvre toutes les commandes du paiement groupé (cf. order.checkout).
    const clientSecret = await this.payments.clientSecret(order.checkoutId);
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
      // Avant paiement, tout le paiement groupé est annulé (le montant du paiement reste cohérent).
      await this.payments.cancelPaymentIntent(order.checkoutId);
      await this.state.transition({
        orderId: order.id,
        to: 'CANCELLED',
        actor,
        actorId: user.id,
        note: reason,
        expectedFrom: 'PENDING_PAYMENT',
      });
      await this.checkouts.cancelPending(
        order.checkoutId,
        'SYSTEM',
        null,
        'Annulation d’une autre commande du même paiement',
        false,
      );
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
      select: { checkoutId: true },
      distinct: ['checkoutId'],
      take: 200,
    });
    let count = 0;
    for (const { checkoutId } of expired) {
      try {
        count += await this.checkouts.cancelPending(
          checkoutId,
          'SYSTEM',
          null,
          'Délai de paiement dépassé',
        );
      } catch (e) {
        this.logger.warn(`Expiration du paiement ${checkoutId} impossible : ${String(e)}`);
      }
    }
    return count;
  }

  /** Paiement groupé et ses commandes (acheteur ou équipe). */
  async checkoutDto(user: AuthUser, checkoutId: string): Promise<CheckoutDto> {
    const checkout = await this.prisma.checkout.findUnique({
      where: { id: checkoutId },
      include: { payment: true, orders: { include: ORDER_INCLUDE, orderBy: { createdAt: 'asc' } } },
    });
    const staff = user.role === 'ADMIN' || user.role === 'MODERATOR';
    if (!checkout || (checkout.buyerId !== user.id && !staff)) {
      throw new NotFoundException('Paiement introuvable');
    }
    return {
      id: checkout.id,
      reference: checkout.reference,
      totalCents: checkout.totalCents,
      paymentStatus: checkout.payment?.status ?? null,
      orders: await Promise.all(checkout.orders.map((o) => this.toDto(o, user))),
      createdAt: checkout.createdAt.toISOString(),
    };
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
      paymentStatus: o.checkout.payment?.status ?? null,
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
      checkout: {
        id: o.checkout.id,
        reference: o.checkout.reference,
        orderCount: o.checkout._count.orders,
        totalCents: o.checkout.totalCents,
      },
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    };
  }
}
