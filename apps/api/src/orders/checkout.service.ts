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
import { Checkout, DeliveryMode, Prisma } from '@prisma/client';
import {
  CART_MAX_ITEMS,
  OrderActor,
  OrderPricing,
  PENDING_PAYMENT_EXPIRY_MINUTES,
} from '@snapmarket/shared';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/auth.decorators';
import { orderReference } from '../common/utils/crypto';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import { AddressDto } from './dto/order.dto';
import { OrderStateService, reserveStock } from './order-state.service';
import { computeOrderPricing } from './pricing';

const MAX_PENDING_CHECKOUTS_PER_BUYER = 5;

export interface CheckoutItemInput {
  productId: string;
  quantity: number;
  deliveryMode: DeliveryMode;
  offerId?: string;
}

/**
 * Création des paiements groupés. Une commande est créée par annonce (cycle de vie,
 * expédition, versement et remboursement indépendants), toutes réglées par un seul
 * PaymentIntent. La réservation du stock est atomique pour l'ensemble : si un seul
 * article n'est plus disponible, rien n'est réservé.
 *
 * Livraison : chaque annonce porte ses propres frais (pas de regroupement de colis entre
 * annonces d'un même vendeur au MVP). Avant paiement, l'annulation porte sur tout le
 * paiement groupé : le montant du PaymentIntent reste ainsi égal à la somme des commandes.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly state: OrderStateService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  async create(
    user: AuthUser,
    items: CheckoutItemInput[],
    shippingAddress: AddressDto | undefined,
  ): Promise<{ checkout: Checkout; clientSecret: string }> {
    if (!this.payments.available) {
      throw new ServiceUnavailableException({
        message: 'Le paiement en ligne n’est pas encore disponible',
        code: 'PAYMENTS_UNAVAILABLE',
      });
    }
    if (items.length === 0) throw new BadRequestException('Aucun article à commander');
    if (items.length > CART_MAX_ITEMS)
      throw new BadRequestException(`${CART_MAX_ITEMS} articles maximum`);
    if (new Set(items.map((i) => i.productId)).size !== items.length) {
      throw new BadRequestException('Article en double');
    }
    if (items.some((i) => i.deliveryMode === 'SHIPPING') && !shippingAddress) {
      throw new BadRequestException('Adresse de livraison requise');
    }
    const pendingCheckouts = await this.prisma.checkout.count({
      where: { buyerId: user.id, orders: { some: { status: 'PENDING_PAYMENT' } } },
    });
    if (pendingCheckouts >= MAX_PENDING_CHECKOUTS_PER_BUYER) {
      throw new HttpException('Trop de paiements en attente', HttpStatus.TOO_MANY_REQUESTS);
    }

    // Le vendeur et le prix sont toujours déterminés côté serveur à partir de l'annonce.
    const products = await this.prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId) } },
      include: { seller: { include: { sellerProfile: true } } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const blocked = new Set(await this.users.blockedIds(user.id));
    const { commissionBps } = await this.settings.get();

    const lines: {
      item: CheckoutItemInput;
      product: (typeof products)[number];
      quantity: number;
      unitPriceCents: number;
      pricing: OrderPricing;
    }[] = [];
    for (const item of items) {
      const product = byId.get(item.productId);
      if (!product || product.deletedAt) throw new NotFoundException('Annonce introuvable');
      const label = `« ${product.title} »`;
      if (product.sellerId === user.id) {
        throw new BadRequestException('Vous ne pouvez pas acheter votre propre annonce');
      }
      if (product.seller.status !== 'ACTIVE')
        throw new ConflictException(`Le vendeur de ${label} n’est plus actif`);
      if (blocked.has(product.sellerId))
        throw new ForbiddenException(`Achat impossible pour ${label}`);
      if (!product.deliveryModes.includes(item.deliveryMode)) {
        throw new BadRequestException(`Mode de livraison non proposé pour ${label}`);
      }
      if (
        !product.seller.sellerProfile?.stripePayoutsEnabled ||
        !product.seller.sellerProfile.stripeAccountId
      ) {
        throw new ConflictException({
          message: `Le vendeur de ${label} n’a pas encore activé la réception des paiements`,
          code: 'SELLER_PAYOUTS_NOT_READY',
        });
      }
      let quantity = item.quantity;
      let unitPriceCents = product.priceCents;
      if (item.offerId) {
        const offer = await this.prisma.offer.findUnique({ where: { id: item.offerId } });
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
      const pricing = computeOrderPricing({
        unitPriceCents,
        quantity,
        shippingFeeCents: item.deliveryMode === 'SHIPPING' ? (product.shippingFeeCents ?? 0) : 0,
        commissionBps,
      });
      lines.push({ item, product, quantity, unitPriceCents, pricing });
    }
    const totalCents = lines.reduce((sum, l) => sum + l.pricing.totalCents, 0);
    const paymentExpiresAt = new Date(Date.now() + PENDING_PAYMENT_EXPIRY_MINUTES * 60_000);

    const checkout = await this.prisma.$transaction(async (tx) => {
      // Ordre de verrouillage stable (identifiant) pour éviter les interblocages entre paniers.
      for (const line of [...lines].sort((a, b) => a.product.id.localeCompare(b.product.id))) {
        if (!(await reserveStock(tx, line.product.id, line.quantity))) {
          throw new ConflictException({
            message: `« ${line.product.title} » n’est plus disponible`,
            code: 'PRODUCT_UNAVAILABLE',
            productId: line.product.id,
          });
        }
        if (line.item.offerId) {
          const used = await tx.offer.updateMany({
            where: { id: line.item.offerId, status: 'ACCEPTED' },
            data: { status: 'USED' },
          });
          if (used.count !== 1) throw new ConflictException('Offre déjà utilisée');
        }
      }
      const created = await tx.checkout.create({
        data: {
          reference: orderReference().replace(/^SM-/, 'SC-'),
          buyerId: user.id,
          totalCents,
          paymentExpiresAt,
        },
      });
      for (const line of lines) {
        const order = await tx.order.create({
          data: {
            reference: orderReference(),
            checkoutId: created.id,
            buyerId: user.id,
            sellerId: line.product.sellerId,
            productId: line.product.id,
            offerId: line.item.offerId ?? null,
            quantity: line.quantity,
            deliveryMode: line.item.deliveryMode,
            unitPriceCents: line.unitPriceCents,
            itemPriceCents: line.pricing.itemPriceCents,
            shippingFeeCents: line.pricing.shippingFeeCents,
            totalCents: line.pricing.totalCents,
            commissionBps: line.pricing.commissionBps,
            commissionCents: line.pricing.commissionCents,
            sellerPayoutCents: line.pricing.sellerPayoutCents,
            shippingAddress:
              line.item.deliveryMode === 'SHIPPING'
                ? (shippingAddress as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            paymentExpiresAt,
          },
        });
        await tx.orderStatusEvent.create({
          data: {
            orderId: order.id,
            from: null,
            to: 'PENDING_PAYMENT',
            actorType: 'BUYER',
            actorId: user.id,
          },
        });
      }
      await this.audit.log(
        {
          actorId: user.id,
          action: 'checkout.create',
          entityType: 'Checkout',
          entityId: created.id,
          metadata: {
            totalCents,
            lines: lines.map((l) => ({
              productId: l.product.id,
              quantity: l.quantity,
              ...l.pricing,
            })),
          },
        },
        tx,
      );
      return created;
    });

    try {
      const clientSecret = await this.payments.createPaymentIntent(checkout);
      return { checkout, clientSecret };
    } catch (e) {
      this.logger.error(`Création du paiement impossible pour ${checkout.id} : ${String(e)}`);
      await this.cancelPending(
        checkout.id,
        'SYSTEM',
        null,
        'Échec de l’initialisation du paiement',
        false,
      );
      throw new BadGatewayException('Le paiement n’a pas pu être initialisé, réessayez plus tard');
    }
  }

  /** Annule toutes les commandes encore en attente de paiement d'un paiement groupé. */
  async cancelPending(
    checkoutId: string,
    actor: OrderActor,
    actorId: string | null,
    note: string | undefined,
    cancelIntent = true,
  ): Promise<number> {
    if (cancelIntent) await this.payments.cancelPaymentIntent(checkoutId);
    const pending = await this.prisma.order.findMany({
      where: { checkoutId, status: 'PENDING_PAYMENT' },
      select: { id: true },
    });
    for (const { id } of pending) {
      await this.state.transition({
        orderId: id,
        to: 'CANCELLED',
        actor,
        actorId,
        note,
        expectedFrom: 'PENDING_PAYMENT',
      });
    }
    return pending.length;
  }
}
