import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CART_MAX_ITEMS, CartCheckoutSession, CartDto, CartItemDto } from '@snapmarket/shared';
import { AuthUser } from '../common/decorators/auth.decorators';
import { CheckoutService } from '../orders/checkout.service';
import { OrdersService } from '../orders/orders.service';
import { bundleShippingFees } from '../orders/pricing';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { PRODUCT_SUMMARY_INCLUDE, ProductsService } from '../products/products.service';
import { UsersService } from '../users/users.service';
import { CartCheckoutDto, UpsertCartItemDto } from './dto/cart.dto';

const CART_INCLUDE = {
  product: {
    include: {
      ...PRODUCT_SUMMARY_INCLUDE,
      seller: { include: { ...PRODUCT_SUMMARY_INCLUDE.seller.include, sellerProfile: true } },
    },
  },
} satisfies Prisma.CartItemInclude;

type CartRow = Prisma.CartItemGetPayload<{ include: typeof CART_INCLUDE }>;

/**
 * Panier : une ligne par annonce. Il ne réserve rien — la disponibilité et les prix sont
 * revérifiés au passage en paiement, qui crée une commande par ligne (paiement groupé).
 * La livraison est regroupée par vendeur (un colis) : voir bundleShippingFees.
 * Les lignes payées sont retirées du panier à la confirmation du paiement.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly users: UsersService,
    private readonly payments: PaymentsService,
    private readonly checkouts: CheckoutService,
    private readonly orders: OrdersService,
  ) {}

  async get(user: AuthUser): Promise<CartDto> {
    const rows = await this.prisma.cartItem.findMany({
      where: { userId: user.id },
      include: CART_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    const blocked = new Set(await this.users.blockedIds(user.id));
    const pendingProducts = new Set(
      (
        await this.prisma.order.findMany({
          where: {
            buyerId: user.id,
            status: 'PENDING_PAYMENT',
            productId: { in: rows.map((r) => r.productId) },
          },
          select: { productId: true },
        })
      ).map((o) => o.productId),
    );
    const summaries = await this.products.toSummaries(
      rows.map((r) => r.product),
      user,
    );
    const shippingFees = bundleShippingFees(
      rows.map((r) => ({
        sellerId: r.product.sellerId,
        feeCents: r.deliveryMode === 'SHIPPING' ? (r.product.shippingFeeCents ?? 0) : 0,
      })),
    );
    const items: CartItemDto[] = rows.map((row, i) => {
      const p = row.product;
      const available = Math.max(0, p.quantity - p.reservedQuantity);
      const shipping = shippingFees[i]!;
      return {
        product: summaries[i]!,
        quantity: row.quantity,
        availableQuantity: available,
        deliveryMode: row.deliveryMode,
        deliveryModes: p.deliveryModes,
        shippingFeeCents: p.deliveryModes.includes('SHIPPING') ? p.shippingFeeCents : null,
        lineItemCents: p.priceCents * row.quantity + shipping,
        issue: this.issueFor(row, available, blocked, pendingProducts),
      };
    });
    const itemsTotalCents = rows.reduce((s, r) => s + r.product.priceCents * r.quantity, 0);
    const shippingTotalCents = shippingFees.reduce((s, f) => s + f, 0);
    return {
      items,
      itemsTotalCents,
      shippingTotalCents,
      totalCents: itemsTotalCents + shippingTotalCents,
      sellerCount: new Set(rows.map((r) => r.product.sellerId)).size,
      ready: items.length > 0 && items.every((i) => i.issue === null),
    };
  }

  private issueFor(
    row: CartRow,
    available: number,
    blocked: Set<string>,
    pending: Set<string>,
  ): string | null {
    const p = row.product;
    if (pending.has(p.id)) return 'Paiement en attente pour cet article (commande en cours)';
    if (
      p.deletedAt ||
      p.moderationStatus !== 'VISIBLE' ||
      p.seller.status !== 'ACTIVE' ||
      blocked.has(p.sellerId)
    ) {
      return 'Cet article n’est plus disponible';
    }
    if (p.status !== 'ACTIVE' || available <= 0) return 'Cet article n’est plus disponible';
    if (row.quantity > available) return `Quantité disponible : ${available}`;
    if (!this.payments.available) return 'Le paiement en ligne n’est pas encore disponible';
    if (!p.seller.sellerProfile?.stripePayoutsEnabled) {
      return 'Le vendeur n’a pas encore activé la réception des paiements';
    }
    if (!row.deliveryMode || !p.deliveryModes.includes(row.deliveryMode))
      return 'Choisissez un mode de remise';
    return null;
  }

  async upsert(user: AuthUser, productId: string, dto: UpsertCartItemDto): Promise<CartDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { seller: true },
    });
    if (
      !product ||
      product.deletedAt ||
      product.moderationStatus !== 'VISIBLE' ||
      product.seller.status !== 'ACTIVE'
    ) {
      throw new NotFoundException('Annonce introuvable');
    }
    if (product.sellerId === user.id)
      throw new BadRequestException('Vous ne pouvez pas acheter votre propre annonce');
    if (await this.users.isBlockedBetween(user.id, product.sellerId)) {
      throw new NotFoundException('Annonce introuvable');
    }
    if (product.status !== 'ACTIVE')
      throw new ConflictException('Cet article n’est plus disponible');
    const quantity = dto.quantity ?? 1;
    const available = product.quantity - product.reservedQuantity;
    if (quantity > available)
      throw new ConflictException(`Quantité disponible : ${Math.max(0, available)}`);
    if (dto.deliveryMode && !product.deliveryModes.includes(dto.deliveryMode)) {
      throw new BadRequestException('Mode de remise non proposé pour cette annonce');
    }
    const existing = await this.prisma.cartItem.findUnique({
      where: { userId_productId: { userId: user.id, productId } },
    });
    if (
      !existing &&
      (await this.prisma.cartItem.count({ where: { userId: user.id } })) >= CART_MAX_ITEMS
    ) {
      throw new BadRequestException(`Votre panier est limité à ${CART_MAX_ITEMS} articles`);
    }
    // Un seul mode proposé : il est choisi d'office.
    const deliveryMode =
      dto.deliveryMode ??
      existing?.deliveryMode ??
      (product.deliveryModes.length === 1 ? product.deliveryModes[0] : null);
    await this.prisma.cartItem.upsert({
      where: { userId_productId: { userId: user.id, productId } },
      create: { userId: user.id, productId, quantity, deliveryMode },
      update: { quantity, deliveryMode },
    });
    return this.get(user);
  }

  async remove(user: AuthUser, productId: string): Promise<CartDto> {
    await this.prisma.cartItem.deleteMany({ where: { userId: user.id, productId } });
    return this.get(user);
  }

  async clear(user: AuthUser): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { userId: user.id } });
  }

  async checkout(user: AuthUser, dto: CartCheckoutDto): Promise<CartCheckoutSession> {
    const cart = await this.get(user);
    if (cart.items.length === 0) throw new BadRequestException('Votre panier est vide');
    const issues = cart.items.filter((i) => i.issue);
    if (issues.length > 0) {
      throw new ConflictException({
        message: 'Certains articles du panier ne peuvent pas être commandés',
        code: 'CART_NOT_READY',
        issues: issues.map((i) => ({ productId: i.product.id, issue: i.issue })),
      });
    }
    const { checkout, clientSecret } = await this.checkouts.create(
      user,
      cart.items.map((i) => ({
        productId: i.product.id,
        quantity: i.quantity,
        deliveryMode: i.deliveryMode!,
      })),
      dto.shippingAddress,
    );
    return {
      checkout: await this.orders.checkoutDto(user, checkout.id),
      paymentClientSecret: clientSecret,
    };
  }
}
