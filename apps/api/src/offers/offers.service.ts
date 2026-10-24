import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Offer } from '@prisma/client';
import { formatCents, OFFER_ACCEPTED_VALIDITY_HOURS, OfferDto } from '@snapmarket/shared';
import { ConversationsService } from '../conversations/conversations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import { CreateOfferDto, ListOffersDto } from './dto/offer.dto';

/** Une offre ne peut pas descendre sous 30 % du prix affiché (anti-abus). */
const MIN_OFFER_RATIO = 0.3;
const PENDING_OFFER_TTL_HOURS = 72;

export function offerDto(o: Offer): OfferDto {
  return {
    id: o.id,
    productId: o.productId,
    buyerId: o.buyerId,
    sellerId: o.sellerId,
    amountCents: o.amountCents,
    status: o.status,
    expiresAt: o.expiresAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly conversations: ConversationsService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(buyerId: string, dto: CreateOfferDto): Promise<OfferDto> {
    if (!(await this.settings.get()).offersEnabled) {
      throw new ForbiddenException('Les offres sont temporairement désactivées');
    }
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (
      !product ||
      product.deletedAt ||
      product.status !== 'ACTIVE' ||
      product.moderationStatus !== 'VISIBLE'
    ) {
      throw new NotFoundException('Annonce introuvable ou indisponible');
    }
    if (!product.offersEnabled)
      throw new BadRequestException('Le vendeur n’accepte pas les offres');
    if (product.sellerId === buyerId)
      throw new BadRequestException('Impossible de faire une offre sur votre annonce');
    if (dto.amountCents >= product.priceCents) {
      throw new BadRequestException('L’offre doit être inférieure au prix affiché');
    }
    if (dto.amountCents < Math.ceil(product.priceCents * MIN_OFFER_RATIO)) {
      throw new BadRequestException('Offre trop basse');
    }
    if (await this.users.isBlockedBetween(buyerId, product.sellerId)) {
      throw new ForbiddenException('Impossible de faire une offre à ce vendeur');
    }
    const pending = await this.prisma.offer.count({
      where: { productId: product.id, buyerId, status: { in: ['PENDING', 'ACCEPTED'] } },
    });
    if (pending > 0)
      throw new ConflictException('Vous avez déjà une offre en cours sur cette annonce');

    const conversation = await this.conversations.open(buyerId, { productId: product.id });
    const offer = await this.prisma.offer.create({
      data: {
        productId: product.id,
        buyerId,
        sellerId: product.sellerId,
        conversationId: conversation.id,
        amountCents: dto.amountCents,
        expiresAt: new Date(Date.now() + PENDING_OFFER_TTL_HOURS * 3600_000),
      },
    });
    await this.conversations.systemMessage(
      conversation.id,
      `Offre de ${formatCents(dto.amountCents)} pour « ${product.title} »`,
    );
    await this.notifications.notify({
      userId: product.sellerId,
      type: 'OFFER_UPDATE',
      title: 'Nouvelle offre',
      body: `${formatCents(dto.amountCents)} proposés pour « ${product.title} »`,
      data: { offerId: offer.id, productId: product.id, conversationId: conversation.id },
    });
    return offerDto(offer);
  }

  async accept(sellerId: string, id: string): Promise<OfferDto> {
    const offer = await this.respond(sellerId, id, 'ACCEPTED');
    await this.after(
      offer,
      'Offre acceptée',
      `Votre offre de ${formatCents(offer.amountCents)} a été acceptée. Vous avez ${OFFER_ACCEPTED_VALIDITY_HOURS} h pour payer.`,
    );
    return offerDto(offer);
  }

  async decline(sellerId: string, id: string): Promise<OfferDto> {
    const offer = await this.respond(sellerId, id, 'DECLINED');
    await this.after(
      offer,
      'Offre refusée',
      `Votre offre de ${formatCents(offer.amountCents)} a été refusée.`,
    );
    return offerDto(offer);
  }

  async cancel(buyerId: string, id: string): Promise<OfferDto> {
    const offer = await this.prisma.offer.findUnique({ where: { id } });
    if (!offer || offer.buyerId !== buyerId) throw new NotFoundException('Offre introuvable');
    const res = await this.prisma.offer.updateMany({
      where: { id, status: { in: ['PENDING', 'ACCEPTED'] } },
      data: { status: 'CANCELLED', respondedAt: new Date() },
    });
    if (res.count === 0) throw new ConflictException('Cette offre ne peut plus être annulée');
    return offerDto(await this.prisma.offer.findUniqueOrThrow({ where: { id } }));
  }

  async list(userId: string, query: ListOffersDto): Promise<OfferDto[]> {
    const rows = await this.prisma.offer.findMany({
      where: {
        ...(query.role === 'buyer' ? { buyerId: userId } : { sellerId: userId }),
        ...(query.productId ? { productId: query.productId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(offerDto);
  }

  /** Tâche planifiée : expiration des offres en attente ou acceptées non utilisées. */
  async expire(now = new Date()): Promise<number> {
    const res = await this.prisma.offer.updateMany({
      where: { status: { in: ['PENDING', 'ACCEPTED'] }, expiresAt: { lt: now } },
      data: { status: 'EXPIRED' },
    });
    return res.count;
  }

  private async respond(
    sellerId: string,
    id: string,
    status: 'ACCEPTED' | 'DECLINED',
  ): Promise<Offer> {
    const offer = await this.prisma.offer.findUnique({ where: { id } });
    if (!offer || offer.sellerId !== sellerId) throw new NotFoundException('Offre introuvable');
    const res = await this.prisma.offer.updateMany({
      where: { id, status: 'PENDING', expiresAt: { gt: new Date() } },
      data: {
        status,
        respondedAt: new Date(),
        expiresAt:
          status === 'ACCEPTED'
            ? new Date(Date.now() + OFFER_ACCEPTED_VALIDITY_HOURS * 3600_000)
            : undefined,
      },
    });
    if (res.count === 0) throw new ConflictException('Cette offre n’est plus en attente');
    return this.prisma.offer.findUniqueOrThrow({ where: { id } });
  }

  private async after(offer: Offer, title: string, body: string): Promise<void> {
    if (offer.conversationId) await this.conversations.systemMessage(offer.conversationId, body);
    await this.notifications.notify({
      userId: offer.buyerId,
      type: 'OFFER_UPDATE',
      title,
      body,
      data: { offerId: offer.id, productId: offer.productId },
    });
  }
}
