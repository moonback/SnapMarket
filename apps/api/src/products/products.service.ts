import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, Product, UserRole } from '@prisma/client';
import { Paginated, ProductDetail, ProductSummary } from '@snapmarket/shared';
import { AuditService } from '../audit/audit.service';
import { categoryDto } from '../categories/categories.service';
import { AuthUser } from '../common/decorators/auth.decorators';
import { decodeCursor, pageSize, paginate } from '../common/utils/pagination';
import { MediaService } from '../media/media.service';
import { SpamService } from '../moderation/spam.service';
import { StripeService } from '../payments/stripe.service';
import { PrismaService } from '../prisma/prisma.service';
import { USER_SUMMARY_INCLUDE, UserPresenter } from '../users/user-presenter.service';
import { UsersService } from '../users/users.service';
import {
  CreateProductDto,
  MyProductsDto,
  ProductSort,
  SearchProductsDto,
  UpdateProductDto,
} from './dto/product.dto';

export const PRODUCT_SUMMARY_INCLUDE = {
  seller: { include: USER_SUMMARY_INCLUDE },
  media: { include: { media: true }, orderBy: { position: 'asc' }, take: 1 },
} satisfies Prisma.ProductInclude;

const PRODUCT_DETAIL_INCLUDE = {
  seller: { include: { ...USER_SUMMARY_INCLUDE, sellerProfile: true } },
  media: { include: { media: true }, orderBy: { position: 'asc' } },
  category: true,
} satisfies Prisma.ProductInclude;

type ProductWithSummary = Prisma.ProductGetPayload<{ include: typeof PRODUCT_SUMMARY_INCLUDE }>;
type ProductWithDetail = Prisma.ProductGetPayload<{ include: typeof PRODUCT_DETAIL_INCLUDE }>;

const STAFF: UserRole[] = ['ADMIN', 'MODERATOR'];

/** Conditions de visibilité publique d'une annonce. */
export const PUBLICLY_VISIBLE: Prisma.ProductWhereInput = {
  status: { in: ['ACTIVE', 'RESERVED'] },
  moderationStatus: 'VISIBLE',
  deletedAt: null,
  seller: { status: 'ACTIVE' },
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly presenter: UserPresenter,
    private readonly users: UsersService,
    private readonly spam: SpamService,
    private readonly stripe: StripeService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Écriture
  // ------------------------------------------------------------------

  async create(user: AuthUser, dto: CreateProductDto): Promise<ProductDetail> {
    this.validateDelivery(dto.deliveryModes, dto.shippingFeeCents);
    const category = await this.activeCategory(dto.categoryId);
    await this.media.assertUsable(user.id, dto.mediaIds, 'PRODUCT');
    const publish = dto.publish === true;
    if (publish) this.assertPublishable(user, dto.mediaIds.length);
    const moderationStatus = await this.initialModeration(
      user.id,
      `${dto.title}\n${dto.description}`,
      category.requiresReview,
    );

    const product = await this.prisma.product.create({
      data: {
        sellerId: user.id,
        categoryId: category.id,
        title: dto.title,
        description: dto.description,
        priceCents: dto.priceCents,
        condition: dto.condition,
        brand: dto.brand || null,
        quantity: dto.quantity ?? 1,
        deliveryModes: dto.deliveryModes,
        shippingFeeCents: dto.deliveryModes.includes('SHIPPING') ? dto.shippingFeeCents! : null,
        city: dto.city || null,
        postalCode: dto.postalCode || null,
        offersEnabled: dto.offersEnabled ?? true,
        status: publish ? 'ACTIVE' : 'DRAFT',
        publishedAt: publish ? new Date() : null,
        moderationStatus,
        media: { create: dto.mediaIds.map((mediaId, position) => ({ mediaId, position })) },
      },
    });
    return this.detail(product.id, user);
  }

  async update(user: AuthUser, id: string, dto: UpdateProductDto): Promise<ProductDetail> {
    const product = await this.getOwned(user.id, id);
    if (product.status === 'SOLD')
      throw new BadRequestException('Une annonce vendue ne peut plus être modifiée');
    const deliveryModes = dto.deliveryModes ?? product.deliveryModes;
    const shippingFee =
      dto.shippingFeeCents !== undefined
        ? dto.shippingFeeCents
        : (product.shippingFeeCents ?? undefined);
    this.validateDelivery(deliveryModes, shippingFee);
    let requiresReview = false;
    if (dto.categoryId && dto.categoryId !== product.categoryId) {
      requiresReview = (await this.activeCategory(dto.categoryId)).requiresReview;
    }
    if (dto.quantity !== undefined && dto.quantity < product.reservedQuantity) {
      throw new BadRequestException(
        'La quantité ne peut pas être inférieure aux réservations en cours',
      );
    }

    let removedMedia: string[] = [];
    if (dto.mediaIds) {
      await this.media.assertUsable(user.id, dto.mediaIds, 'PRODUCT');
      const current = await this.prisma.productMedia.findMany({ where: { productId: id } });
      removedMedia = current.map((m) => m.mediaId).filter((m) => !dto.mediaIds!.includes(m));
      if (product.status === 'ACTIVE' && dto.mediaIds.length === 0) {
        throw new BadRequestException('Une annonce publiée doit avoir au moins une photo');
      }
    }

    let moderationStatus = product.moderationStatus;
    if (dto.title !== undefined || dto.description !== undefined || requiresReview) {
      if (product.moderationStatus !== 'REMOVED') {
        moderationStatus = await this.initialModeration(
          user.id,
          `${dto.title ?? product.title}\n${dto.description ?? product.description}`,
          requiresReview,
          product.moderationStatus,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          priceCents: dto.priceCents,
          categoryId: dto.categoryId,
          condition: dto.condition,
          brand: dto.brand,
          quantity: dto.quantity,
          deliveryModes: dto.deliveryModes,
          shippingFeeCents: deliveryModes.includes('SHIPPING') ? shippingFee : null,
          city: dto.city,
          postalCode: dto.postalCode,
          offersEnabled: dto.offersEnabled,
          moderationStatus,
        },
      });
      if (dto.mediaIds) {
        await tx.productMedia.deleteMany({ where: { productId: id } });
        await tx.productMedia.createMany({
          data: dto.mediaIds.map((mediaId, position) => ({ productId: id, mediaId, position })),
        });
      }
    });
    if (removedMedia.length > 0) await this.media.softDelete(removedMedia);
    if (dto.publish === true && product.status === 'DRAFT') return this.publish(user, id);
    return this.detail(id, user);
  }

  async publish(user: AuthUser, id: string): Promise<ProductDetail> {
    const product = await this.getOwned(user.id, id);
    if (!['DRAFT', 'ARCHIVED'].includes(product.status)) {
      throw new BadRequestException('Cette annonce ne peut pas être publiée');
    }
    if (product.quantity <= 0) throw new BadRequestException('Stock épuisé');
    const mediaCount = await this.prisma.productMedia.count({ where: { productId: id } });
    this.assertPublishable(user, mediaCount);
    await this.prisma.product.update({
      where: { id },
      data: {
        status: product.quantity - product.reservedQuantity > 0 ? 'ACTIVE' : 'RESERVED',
        publishedAt: product.publishedAt ?? new Date(),
      },
    });
    return this.detail(id, user);
  }

  async archive(user: AuthUser, id: string): Promise<ProductDetail> {
    const product = await this.getOwned(user.id, id);
    if (product.reservedQuantity > 0) {
      throw new ConflictException('Une commande est en cours sur cette annonce');
    }
    if (!['ACTIVE', 'DRAFT'].includes(product.status)) {
      throw new BadRequestException('Cette annonce ne peut pas être archivée');
    }
    await this.prisma.product.update({ where: { id }, data: { status: 'ARCHIVED' } });
    return this.detail(id, user);
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const product = await this.getOwned(user.id, id);
    if (product.reservedQuantity > 0) {
      throw new ConflictException('Une commande est en cours sur cette annonce');
    }
    const media = await this.prisma.productMedia.findMany({ where: { productId: id } });
    const hasOrders = (await this.prisma.order.count({ where: { productId: id } })) > 0;
    await this.prisma.$transaction(async (tx) => {
      // Suppression logique : l'historique des commandes conserve la référence.
      await tx.product.update({
        where: { id },
        data: { deletedAt: new Date(), status: product.status === 'SOLD' ? 'SOLD' : 'ARCHIVED' },
      });
      await tx.favorite.deleteMany({ where: { productId: id } });
      if (!hasOrders) await tx.productMedia.deleteMany({ where: { productId: id } });
    });
    if (!hasOrders) await this.media.softDelete(media.map((m) => m.mediaId));
  }

  // ------------------------------------------------------------------
  // Lecture
  // ------------------------------------------------------------------

  async detail(id: string, viewer?: AuthUser): Promise<ProductDetail> {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_DETAIL_INCLUDE,
    });
    if (!p || p.deletedAt) throw new NotFoundException('Annonce introuvable');
    const isOwner = viewer?.id === p.sellerId;
    const isStaff = viewer ? STAFF.includes(viewer.role) : false;
    const publiclyVisible =
      ['ACTIVE', 'RESERVED', 'SOLD'].includes(p.status) &&
      p.moderationStatus === 'VISIBLE' &&
      p.seller.status === 'ACTIVE';
    if (!isOwner && !isStaff) {
      if (!publiclyVisible) throw new NotFoundException('Annonce introuvable');
      if (viewer && (await this.users.isBlockedBetween(viewer.id, p.sellerId))) {
        throw new NotFoundException('Annonce introuvable');
      }
    }
    return this.toDetail(p, viewer);
  }

  async search(
    query: SearchProductsDto,
    viewer?: AuthUser,
    excludeOwn = false,
  ): Promise<Paginated<ProductSummary>> {
    const limit = pageSize(query.limit);
    const sort: ProductSort = query.sort ?? 'recent';
    const cursor = decodeCursor(query.cursor);
    const blocked = await this.users.blockedIds(viewer?.id);
    const excluded = excludeOwn && viewer ? [...blocked, viewer.id] : blocked;

    const and: Prisma.ProductWhereInput[] = [PUBLICLY_VISIBLE];
    if (excluded.length > 0) and.push({ sellerId: { notIn: excluded } });
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { brand: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.categoryId) and.push({ categoryId: query.categoryId });
    if (query.minPriceCents !== undefined) and.push({ priceCents: { gte: query.minPriceCents } });
    if (query.maxPriceCents !== undefined) and.push({ priceCents: { lte: query.maxPriceCents } });
    if (query.conditions?.length) and.push({ condition: { in: query.conditions } });
    if (query.deliveryMode) and.push({ deliveryModes: { has: query.deliveryMode } });
    if (query.city) and.push({ city: { equals: query.city, mode: 'insensitive' } });
    if (query.department) and.push({ postalCode: { startsWith: query.department } });
    if (query.sellerId) and.push({ sellerId: query.sellerId });

    let orderBy: Prisma.ProductOrderByWithRelationInput[];
    if (sort === 'recent') {
      orderBy = [{ publishedAt: 'desc' }, { id: 'desc' }];
      if (cursor) {
        const d = new Date(String(cursor.v));
        and.push({ OR: [{ publishedAt: { lt: d } }, { publishedAt: d, id: { lt: cursor.id } }] });
      }
    } else {
      const dir = sort === 'price_asc' ? 'asc' : 'desc';
      orderBy = [{ priceCents: dir }, { id: dir }];
      if (cursor) {
        const v = Number(cursor.v);
        const cmp = dir === 'asc' ? 'gt' : 'lt';
        and.push({
          OR: [{ priceCents: { [cmp]: v } }, { priceCents: v, id: { [cmp]: cursor.id } }],
        });
      }
    }

    const rows = await this.prisma.product.findMany({
      where: { AND: and },
      orderBy,
      take: limit + 1,
      include: PRODUCT_SUMMARY_INCLUDE,
    });
    const page = paginate(rows, limit, (p) => ({
      v: sort === 'recent' ? (p.publishedAt ?? p.createdAt).toISOString() : p.priceCents,
      id: p.id,
    }));
    return { items: await this.toSummaries(page.items, viewer), nextCursor: page.nextCursor };
  }

  async listMine(user: AuthUser, query: MyProductsDto): Promise<Paginated<ProductSummary>> {
    const limit = pageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.product.findMany({
      where: {
        sellerId: user.id,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
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
      include: PRODUCT_SUMMARY_INCLUDE,
    });
    const page = paginate(rows, limit, (p) => ({ v: p.createdAt.toISOString(), id: p.id }));
    return { items: await this.toSummaries(page.items, user), nextCursor: page.nextCursor };
  }

  /** Annonces vendues d'un utilisateur (profil public). */
  async listSold(sellerId: string, viewer?: AuthUser): Promise<ProductSummary[]> {
    const rows = await this.prisma.product.findMany({
      where: { sellerId, status: 'SOLD', moderationStatus: 'VISIBLE' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: PRODUCT_SUMMARY_INCLUDE,
    });
    return this.toSummaries(rows, viewer);
  }

  // ------------------------------------------------------------------
  // Mapping
  // ------------------------------------------------------------------

  async toSummaries(rows: ProductWithSummary[], viewer?: AuthUser): Promise<ProductSummary[]> {
    const favorites = viewer
      ? new Set(
          (
            await this.prisma.favorite.findMany({
              where: { userId: viewer.id, productId: { in: rows.map((r) => r.id) } },
              select: { productId: true },
            })
          ).map((f) => f.productId),
        )
      : new Set<string>();
    return Promise.all(rows.map((r) => this.toSummary(r, favorites.has(r.id))));
  }

  async toSummary(p: ProductWithSummary, isFavorite: boolean): Promise<ProductSummary> {
    const cover = p.media[0]?.media;
    return {
      id: p.id,
      title: p.title,
      priceCents: p.priceCents,
      currency: 'EUR',
      condition: p.condition,
      status: p.status,
      brand: p.brand,
      city: p.city,
      deliveryModes: p.deliveryModes,
      cover: cover ? await this.media.toDto(cover) : null,
      seller: await this.presenter.summary(p.seller),
      isFavorite,
      favoritesCount: p.favoritesCount,
      createdAt: (p.publishedAt ?? p.createdAt).toISOString(),
    };
  }

  private async toDetail(p: ProductWithDetail, viewer?: AuthUser): Promise<ProductDetail> {
    const isFavorite = viewer
      ? (await this.prisma.favorite.count({ where: { userId: viewer.id, productId: p.id } })) > 0
      : false;
    const summary = await this.toSummary({ ...p, media: p.media.slice(0, 1) }, isFavorite);
    const available = Math.max(0, p.quantity - p.reservedQuantity);
    return {
      ...summary,
      description: p.description,
      category: categoryDto(p.category),
      quantity: p.quantity,
      availableQuantity: available,
      shippingFeeCents: p.shippingFeeCents,
      postalCode: p.postalCode,
      offersEnabled: p.offersEnabled,
      media: await Promise.all(
        p.media.filter((m) => m.media.status === 'READY').map((m) => this.media.toDto(m.media)),
      ),
      updatedAt: p.updatedAt.toISOString(),
      isOwner: viewer?.id === p.sellerId,
      purchase: this.purchaseAvailability(p, available, viewer),
      moderationStatus: p.moderationStatus,
    };
  }

  private purchaseAvailability(
    p: ProductWithDetail,
    available: number,
    viewer?: AuthUser,
  ): { available: boolean; reason: string | null } {
    const no = (reason: string) => ({ available: false, reason });
    if (viewer?.id === p.sellerId) return no('Il s’agit de votre annonce');
    if (p.status !== 'ACTIVE' || available <= 0) return no('Cet article n’est plus disponible');
    if (p.moderationStatus !== 'VISIBLE') return no('Annonce en cours de vérification');
    if (!this.stripe.configured) return no('Le paiement en ligne n’est pas encore disponible');
    if (!p.seller.sellerProfile?.stripePayoutsEnabled) {
      return no('Le vendeur n’a pas encore activé la réception des paiements');
    }
    return { available: true, reason: null };
  }

  // ------------------------------------------------------------------
  // Utilitaires
  // ------------------------------------------------------------------

  async getOwned(userId: string, id: string): Promise<Product> {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.deletedAt) throw new NotFoundException('Annonce introuvable');
    if (product.sellerId !== userId)
      throw new ForbiddenException('Cette annonce ne vous appartient pas');
    return product;
  }

  private validateDelivery(modes: string[], shippingFeeCents: number | undefined): void {
    if (modes.includes('SHIPPING') && shippingFeeCents === undefined) {
      throw new BadRequestException('Les frais de livraison sont requis pour la livraison');
    }
  }

  private assertPublishable(user: AuthUser, mediaCount: number): void {
    if (!user.emailVerified) {
      throw new ForbiddenException({
        message: 'Vérifiez votre adresse email avant de publier une annonce',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }
    if (mediaCount < 1) throw new BadRequestException('Ajoutez au moins une photo pour publier');
  }

  private async activeCategory(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category || !category.isActive) throw new BadRequestException('Catégorie invalide');
    return category;
  }

  private async initialModeration(
    userId: string,
    text: string,
    requiresReview: boolean,
    current: 'VISIBLE' | 'HIDDEN' | 'REMOVED' = 'VISIBLE',
  ): Promise<'VISIBLE' | 'HIDDEN'> {
    const spam = await this.spam.evaluate(userId, 'product', text);
    if (spam.verdict === 'reject') {
      throw new UnprocessableEntityException({
        message:
          'Le contenu de l’annonce a été refusé (moyens de paiement ou contacts hors plateforme)',
        code: 'CONTENT_REJECTED',
      });
    }
    if (spam.verdict === 'flag') {
      await this.audit.log({
        actorId: userId,
        action: 'spam.flag',
        entityType: 'Product',
        metadata: { reasons: spam.reasons, score: spam.score },
      });
    }
    if (requiresReview || current === 'HIDDEN') return 'HIDDEN';
    return 'VISIBLE';
  }
}
