import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { MeUser, PublicUser } from '@snapmarket/shared';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeleteAccountDto, PushTokenDto, UpdateProfileDto } from './dto/users.dto';
import { isProVerified, ratingOf, sellerProfileDto, UserPresenter } from './user-presenter.service';

const ACTIVE_ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'PREPARING',
  'SHIPPED',
  'READY_FOR_HANDOFF',
  'DISPUTED',
] as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presenter: UserPresenter,
    private readonly media: MediaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async me(userId: string): Promise<MeUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { avatar: true, sellerProfile: true },
    });
    const base = await this.publicFromUser(user);
    return {
      ...base,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      role: user.role,
      status: user.status,
      seller: sellerProfileDto(user.sellerProfile),
    };
  }

  async publicProfile(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { avatar: true, sellerProfile: true },
    });
    if (!user || user.status === 'DELETED' || user.status === 'BANNED') {
      throw new NotFoundException('Utilisateur introuvable');
    }
    return this.publicFromUser(user);
  }

  private async publicFromUser(
    user: Parameters<UserPresenter['summary']>[0] & { bio: string | null; city: string | null },
  ): Promise<PublicUser> {
    const [activeListingsCount, soldCount] = await Promise.all([
      this.prisma.product.count({
        where: {
          sellerId: user.id,
          status: { in: ['ACTIVE', 'RESERVED'] },
          moderationStatus: 'VISIBLE',
          deletedAt: null,
        },
      }),
      this.prisma.order.count({ where: { sellerId: user.id, status: 'COMPLETED' } }),
    ]);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: await this.presenter.avatarUrl(user),
      bio: user.bio,
      city: user.city,
      createdAt: user.createdAt.toISOString(),
      accountType: user.sellerProfile?.accountType ?? 'INDIVIDUAL',
      proVerified: isProVerified(user.sellerProfile),
      rating: ratingOf(user),
      activeListingsCount,
      soldCount,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<MeUser> {
    if (dto.username) {
      const taken = await this.prisma.user.findFirst({
        where: { username: { equals: dto.username, mode: 'insensitive' }, NOT: { id: userId } },
      });
      if (taken) throw new ConflictException('Ce pseudonyme est déjà pris');
    }
    let avatarMediaId: string | null | undefined = undefined;
    if (dto.avatarMediaId !== undefined) {
      if (dto.avatarMediaId === null) {
        avatarMediaId = null;
      } else {
        await this.media.assertUsable(userId, [dto.avatarMediaId], 'AVATAR');
        avatarMediaId = dto.avatarMediaId;
      }
    }
    const previous = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: dto.displayName,
        username: dto.username,
        bio: dto.bio,
        city: dto.city,
        avatarMediaId,
      },
    });
    if (
      avatarMediaId !== undefined &&
      previous.avatarMediaId &&
      previous.avatarMediaId !== avatarMediaId
    ) {
      await this.media.softDelete([previous.avatarMediaId]);
    }
    return this.me(userId);
  }

  /**
   * Suppression du compte : les données personnelles sont anonymisées. Les commandes,
   * écritures financières et avis sont conservés (obligations comptables et de preuve),
   * rattachés à un profil anonyme.
   */
  async deleteAccount(userId: string, dto: DeleteAccountDto, ip: string | null): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Mot de passe incorrect');
    }
    const ongoing = await this.prisma.order.count({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
        status: { in: [...ACTIVE_ORDER_STATUSES] },
      },
    });
    if (ongoing > 0) {
      throw new BadRequestException(
        'Des commandes sont en cours. Finalisez-les avant de supprimer votre compte.',
      );
    }
    const storyMedia = await this.prisma.story.findMany({
      where: { authorId: userId, deletedAt: null },
      select: { mediaId: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `deleted+${userId}@deleted.invalid`,
          username: `deleted_${userId}`,
          passwordHash: null,
          displayName: null,
          bio: null,
          city: null,
          avatarMediaId: null,
          status: 'DELETED',
          deletedAt: new Date(),
        },
      });
      await tx.product.updateMany({
        where: { sellerId: userId, status: { in: ['ACTIVE', 'DRAFT', 'RESERVED'] } },
        data: { status: 'ARCHIVED' },
      });
      await tx.story.updateMany({ where: { authorId: userId }, data: { deletedAt: new Date() } });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.pushToken.deleteMany({ where: { userId } });
      await tx.favorite.deleteMany({ where: { userId } });
      await tx.authIdentity.deleteMany({ where: { userId } });
      await this.audit.log(
        { actorId: userId, action: 'user.deleted', entityType: 'User', entityId: userId, ip },
        tx,
      );
    });
    const mediaIds = [user.avatarMediaId, ...storyMedia.map((s) => s.mediaId)].filter(
      (x): x is string => !!x,
    );
    await this.media.softDelete(mediaIds);
  }

  async block(userId: string, targetId: string): Promise<void> {
    if (userId === targetId) throw new BadRequestException('Action impossible');
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('Utilisateur introuvable');
    await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
      create: { blockerId: userId, blockedId: targetId },
      update: {},
    });
  }

  async unblock(userId: string, targetId: string): Promise<void> {
    await this.prisma.block.deleteMany({ where: { blockerId: userId, blockedId: targetId } });
  }

  async listBlocked(userId: string) {
    const rows = await this.prisma.block.findMany({
      where: { blockerId: userId },
      include: { blocked: { include: { avatar: true, sellerProfile: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(rows.map((r) => this.presenter.summary(r.blocked)));
  }

  /** Identifiants des utilisateurs bloqués dans un sens ou dans l'autre. */
  async blockedIds(userId: string | undefined): Promise<string[]> {
    if (!userId) return [];
    const rows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    });
    return rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId));
  }

  async isBlockedBetween(a: string, b: string): Promise<boolean> {
    const count = await this.prisma.block.count({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
    });
    return count > 0;
  }

  async registerPushToken(userId: string, dto: PushTokenDto): Promise<void> {
    await this.prisma.pushToken.upsert({
      where: { token: dto.token },
      create: { userId, token: dto.token, platform: dto.platform },
      update: { userId, platform: dto.platform, lastUsedAt: new Date() },
    });
  }

  async removePushToken(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
  }
}
