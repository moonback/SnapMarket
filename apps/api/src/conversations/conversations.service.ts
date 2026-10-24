import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Message, Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { ConversationDto, MessageDto, Paginated } from '@snapmarket/shared';
import { CursorQueryDto } from '../common/dto/pagination.dto';
import { decodeCursor, pageSize, paginate } from '../common/utils/pagination';
import { MediaService } from '../media/media.service';
import { SpamService } from '../moderation/spam.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { REDIS } from '../redis/redis.module';
import { USER_SUMMARY_INCLUDE, UserPresenter } from '../users/user-presenter.service';
import { UsersService } from '../users/users.service';
import { OpenConversationDto, SendMessageDto } from './dto/conversation.dto';

const MESSAGES_PER_MINUTE = 30;

const CONVERSATION_INCLUDE = {
  participants: { include: { user: { include: USER_SUMMARY_INCLUDE } } },
  product: {
    include: {
      media: { include: { media: true }, orderBy: { position: 'asc' as const }, take: 1 },
    },
  },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;
type MessageRow = Message & { media: Prisma.MediaGetPayload<object> | null };

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly presenter: UserPresenter,
    private readonly media: MediaService,
    private readonly spam: SpamService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async open(userId: string, dto: OpenConversationDto): Promise<ConversationDto> {
    let otherId: string;
    let productId: string | null = null;
    if (dto.productId) {
      const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
      if (!product || product.deletedAt || product.moderationStatus !== 'VISIBLE') {
        throw new NotFoundException('Annonce introuvable');
      }
      otherId = product.sellerId;
      productId = product.id;
    } else if (dto.userId) {
      otherId = dto.userId;
    } else {
      throw new BadRequestException('Annonce ou interlocuteur requis');
    }
    if (otherId === userId)
      throw new BadRequestException('Vous ne pouvez pas vous écrire à vous-même');
    const other = await this.prisma.user.findUnique({ where: { id: otherId } });
    if (!other || other.status !== 'ACTIVE') throw new NotFoundException('Utilisateur introuvable');
    if (await this.users.isBlockedBetween(userId, otherId)) {
      throw new ForbiddenException('Impossible de contacter cet utilisateur');
    }
    const [a, b] = [userId, otherId].sort();
    const dedupeKey = `${a}:${b}:${productId ?? 'none'}`;
    const conversation = await this.prisma.conversation.upsert({
      where: { dedupeKey },
      create: {
        dedupeKey,
        productId,
        participants: { create: [{ userId }, { userId: otherId }] },
      },
      update: {},
    });
    return this.get(userId, conversation.id);
  }

  async list(userId: string, query: CursorQueryDto): Promise<Paginated<ConversationDto>> {
    const limit = pageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.conversation.findMany({
      where: {
        participants: { some: { userId } },
        messages: { some: {} },
        ...(cursor
          ? {
              OR: [
                { lastMessageAt: { lt: new Date(String(cursor.v)) } },
                { lastMessageAt: new Date(String(cursor.v)), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: CONVERSATION_INCLUDE,
    });
    const page = paginate(rows, limit, (c) => ({ v: c.lastMessageAt.toISOString(), id: c.id }));
    const blocked = new Set(await this.users.blockedIds(userId));
    return {
      items: await Promise.all(page.items.map((c) => this.toDto(c, userId, blocked))),
      nextCursor: page.nextCursor,
    };
  }

  async get(userId: string, conversationId: string): Promise<ConversationDto> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: CONVERSATION_INCLUDE,
    });
    if (!conversation || !conversation.participants.some((p) => p.userId === userId)) {
      throw new NotFoundException('Conversation introuvable');
    }
    const blocked = new Set(await this.users.blockedIds(userId));
    return this.toDto(conversation, userId, blocked);
  }

  /** Vérifie l'appartenance à la conversation. Utilisé par REST et WebSocket. */
  async assertParticipant(userId: string, conversationId: string): Promise<string> {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId },
    });
    if (!participants.some((p) => p.userId === userId)) {
      throw new NotFoundException('Conversation introuvable');
    }
    return participants.find((p) => p.userId !== userId)!.userId;
  }

  async messages(
    userId: string,
    conversationId: string,
    query: CursorQueryDto,
  ): Promise<Paginated<MessageDto>> {
    const otherId = await this.assertParticipant(userId, conversationId);
    const limit = pageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
        // Un message masqué par la modération reste visible pour son auteur uniquement.
        OR: [{ moderationStatus: 'VISIBLE' }, { senderId: userId, moderationStatus: 'HIDDEN' }],
        ...(cursor
          ? {
              AND: [
                {
                  OR: [
                    { createdAt: { lt: new Date(String(cursor.v)) } },
                    { createdAt: new Date(String(cursor.v)), id: { lt: cursor.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { media: true },
    });
    const otherRead = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: otherId } },
    });
    const page = paginate(rows, limit, (m) => ({ v: m.createdAt.toISOString(), id: m.id }));
    return {
      items: await Promise.all(
        page.items.map((m) => this.messageDto(m, otherRead?.lastReadAt ?? null)),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async send(userId: string, conversationId: string, dto: SendMessageDto): Promise<MessageDto> {
    if (!dto.body && !dto.mediaId) throw new BadRequestException('Message vide');
    const otherId = await this.assertParticipant(userId, conversationId);

    if (dto.clientMessageId) {
      const existing = await this.prisma.message.findUnique({
        where: {
          senderId_clientMessageId: { senderId: userId, clientMessageId: dto.clientMessageId },
        },
        include: { media: true },
      });
      if (existing) {
        if (existing.conversationId !== conversationId)
          throw new BadRequestException('Identifiant déjà utilisé');
        return this.messageDto(existing, null);
      }
    }
    await this.rateLimit(userId);
    const sender = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { status: true, emailVerifiedAt: true, username: true },
    });
    if (sender.status !== 'ACTIVE') throw new ForbiddenException('Compte inactif');
    if (!sender.emailVerifiedAt) throw new ForbiddenException('Vérifiez votre adresse email');
    if (await this.users.isBlockedBetween(userId, otherId)) {
      throw new ForbiddenException('Impossible d’envoyer un message à cet utilisateur');
    }
    const other = await this.prisma.user.findUnique({
      where: { id: otherId },
      select: { status: true },
    });
    if (other?.status !== 'ACTIVE') throw new ForbiddenException('Ce compte n’est plus actif');
    if (dto.mediaId) await this.media.assertUsable(userId, [dto.mediaId], 'MESSAGE');

    let flagged = false;
    if (dto.body) {
      const spam = await this.spam.evaluate(userId, 'message', dto.body);
      if (spam.verdict === 'reject') {
        throw new UnprocessableEntityException({
          message: 'Message refusé : il ressemble à du spam ou à une tentative de fraude.',
          code: 'MESSAGE_REJECTED',
        });
      }
      flagged = spam.verdict === 'flag';
    }

    let message: MessageRow;
    try {
      message = await this.prisma.$transaction(async (tx) => {
        const m = await tx.message.create({
          data: {
            conversationId,
            senderId: userId,
            type: dto.mediaId ? 'IMAGE' : 'TEXT',
            body: dto.body ?? null,
            mediaId: dto.mediaId ?? null,
            clientMessageId: dto.clientMessageId ?? null,
            flaggedAsSpam: flagged,
          },
          include: { media: true },
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: m.createdAt },
        });
        await tx.conversationParticipant.update({
          where: { conversationId_userId: { conversationId, userId } },
          data: { lastReadAt: m.createdAt },
        });
        return m;
      });
    } catch (e) {
      // Course entre deux envois identiques : renvoyer le message existant.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        dto.clientMessageId
      ) {
        const existing = await this.prisma.message.findUniqueOrThrow({
          where: {
            senderId_clientMessageId: { senderId: userId, clientMessageId: dto.clientMessageId },
          },
          include: { media: true },
        });
        return this.messageDto(existing, null);
      }
      throw e;
    }

    const dto_ = await this.messageDto(message, null);
    this.realtime.toConversation(conversationId, 'message:new', dto_);
    this.realtime.toUser(otherId, 'conversation:updated', { conversationId });
    await this.notifications.notify({
      userId: otherId,
      type: 'NEW_MESSAGE',
      title: `Nouveau message de ${sender.username}`,
      body: dto.body ? dto.body.slice(0, 120) : 'Photo',
      data: { conversationId },
    });
    return dto_;
  }

  async markRead(userId: string, conversationId: string): Promise<void> {
    await this.assertParticipant(userId, conversationId);
    const readAt = new Date();
    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: readAt },
    });
    this.realtime.toConversation(conversationId, 'conversation:read', {
      conversationId,
      userId,
      readAt: readAt.toISOString(),
    });
  }

  async unreadCount(userId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Message" m
      JOIN "ConversationParticipant" p
        ON p."conversationId" = m."conversationId" AND p."userId" = ${userId}
      WHERE m."senderId" IS DISTINCT FROM ${userId}
        AND m."deletedAt" IS NULL
        AND m."moderationStatus" = 'VISIBLE'
        AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")`;
    return Number(rows[0]?.count ?? 0);
  }

  private async rateLimit(userId: string): Promise<void> {
    const key = `rl:messages:${userId}:${Math.floor(Date.now() / 60_000)}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 70);
    if (count > MESSAGES_PER_MINUTE) {
      throw new HttpException(
        'Trop de messages envoyés, patientez un instant',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async toDto(
    c: ConversationRow,
    userId: string,
    blocked: Set<string>,
  ): Promise<ConversationDto> {
    const me = c.participants.find((p) => p.userId === userId)!;
    const other = c.participants.find((p) => p.userId !== userId)!;
    const [last, unreadCount] = await Promise.all([
      this.prisma.message.findFirst({
        where: {
          conversationId: c.id,
          deletedAt: null,
          OR: [{ moderationStatus: 'VISIBLE' }, { senderId: userId }],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { media: true },
      }),
      this.prisma.message.count({
        where: {
          conversationId: c.id,
          deletedAt: null,
          moderationStatus: 'VISIBLE',
          senderId: { not: userId },
          ...(me.lastReadAt ? { createdAt: { gt: me.lastReadAt } } : {}),
        },
      }),
    ]);
    const cover = c.product?.media[0]?.media;
    return {
      id: c.id,
      otherUser: await this.presenter.summary(other.user),
      product: c.product
        ? {
            id: c.product.id,
            title: c.product.title,
            priceCents: c.product.priceCents,
            status: c.product.status,
            cover: cover ? await this.media.toDto(cover) : null,
          }
        : null,
      lastMessage: last ? await this.messageDto(last, other.lastReadAt) : null,
      unreadCount,
      blocked: blocked.has(other.userId),
      updatedAt: c.lastMessageAt.toISOString(),
    };
  }

  async messageDto(m: MessageRow, otherLastReadAt: Date | null): Promise<MessageDto> {
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      type: m.type,
      body: m.body,
      media: m.media && m.media.status !== 'DELETED' ? await this.media.toDto(m.media) : null,
      clientMessageId: m.clientMessageId,
      createdAt: m.createdAt.toISOString(),
      readByOther: otherLastReadAt !== null && m.createdAt <= otherLastReadAt,
    };
  }

  /** Message système (ex. événement de commande) dans une conversation existante. */
  async systemMessage(conversationId: string, body: string): Promise<void> {
    const m = await this.prisma.message.create({
      data: { conversationId, type: 'SYSTEM', body },
      include: { media: true },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: m.createdAt },
    });
    this.realtime.toConversation(conversationId, 'message:new', await this.messageDto(m, null));
  }
}
