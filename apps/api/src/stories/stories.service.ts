import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StoryDto, StoryGroupDto } from '@snapmarket/shared';
import { AuthUser } from '../common/decorators/auth.decorators';
import { MediaService } from '../media/media.service';
import { SpamService } from '../moderation/spam.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { USER_SUMMARY_INCLUDE, UserPresenter } from '../users/user-presenter.service';
import { UsersService } from '../users/users.service';
import { CreateStoryDto } from './dto/story.dto';

const STORY_INCLUDE = {
  author: { include: USER_SUMMARY_INCLUDE },
  media: true,
  product: { select: { id: true, title: true, priceCents: true, status: true, deletedAt: true } },
} satisfies Prisma.StoryInclude;

type StoryRow = Prisma.StoryGetPayload<{ include: typeof STORY_INCLUDE }>;

/**
 * L'expiration est toujours vérifiée à la lecture (expiresAt > maintenant) : une story
 * expirée disparaît même si la tâche de nettoyage n'est pas encore passée.
 */
export function activeStoryWhere(now = new Date()): Prisma.StoryWhereInput {
  return {
    expiresAt: { gt: now },
    deletedAt: null,
    moderationStatus: 'VISIBLE',
    media: { status: 'READY' },
    author: { status: 'ACTIVE' },
  };
}

@Injectable()
export class StoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly presenter: UserPresenter,
    private readonly users: UsersService,
    private readonly settings: SettingsService,
    private readonly spam: SpamService,
  ) {}

  async create(user: AuthUser, dto: CreateStoryDto): Promise<StoryDto> {
    await this.media.assertUsable(user.id, [dto.mediaId], 'STORY');
    if (dto.productId) {
      const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
      if (!product || product.sellerId !== user.id || product.deletedAt) {
        throw new BadRequestException('Annonce invalide');
      }
    }
    if (dto.caption) {
      const spam = await this.spam.evaluate(user.id, 'story', dto.caption);
      if (spam.verdict === 'reject') throw new UnprocessableEntityException('Légende refusée');
    }
    const ttl = dto.ttlHours ?? (await this.settings.get()).storyTtlHours;
    const story = await this.prisma.story.create({
      data: {
        authorId: user.id,
        mediaId: dto.mediaId,
        productId: dto.productId ?? null,
        caption: dto.caption || null,
        expiresAt: new Date(Date.now() + ttl * 3600_000),
      },
      include: STORY_INCLUDE,
    });
    return this.toDto(story, user.id, new Set());
  }

  async feed(viewer?: AuthUser): Promise<StoryGroupDto[]> {
    const blocked = await this.users.blockedIds(viewer?.id);
    const rows = await this.prisma.story.findMany({
      where: { ...activeStoryWhere(), authorId: blocked.length ? { notIn: blocked } : undefined },
      include: STORY_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return this.group(rows, viewer?.id);
  }

  async byUser(authorId: string, viewer?: AuthUser): Promise<StoryGroupDto | null> {
    if (viewer && (await this.users.isBlockedBetween(viewer.id, authorId))) return null;
    const rows = await this.prisma.story.findMany({
      where: { ...activeStoryWhere(), authorId },
      include: STORY_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return (await this.group(rows, viewer?.id))[0] ?? null;
  }

  async markViewed(user: AuthUser, storyId: string): Promise<void> {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, ...activeStoryWhere() },
    });
    if (!story) throw new NotFoundException('Story introuvable ou expirée');
    if (story.authorId === user.id) return;
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.storyView.createMany({
        data: [{ storyId, viewerId: user.id }],
        skipDuplicates: true,
      });
      if (created.count > 0) {
        await tx.story.update({ where: { id: storyId }, data: { viewsCount: { increment: 1 } } });
      }
    });
  }

  async remove(user: AuthUser, storyId: string): Promise<void> {
    const story = await this.prisma.story.findUnique({ where: { id: storyId } });
    if (!story || story.deletedAt) throw new NotFoundException('Story introuvable');
    if (story.authorId !== user.id) throw new ForbiddenException('Accès refusé');
    await this.prisma.story.update({ where: { id: storyId }, data: { deletedAt: new Date() } });
    await this.media.softDelete([story.mediaId]);
  }

  /** Nettoyage asynchrone (worker) : supprime les médias des stories expirées. */
  async cleanupExpired(now = new Date()): Promise<number> {
    const expired = await this.prisma.story.findMany({
      where: {
        OR: [{ expiresAt: { lte: now } }, { deletedAt: { not: null } }],
        media: { status: { not: 'DELETED' } },
      },
      select: { id: true, mediaId: true },
      take: 500,
    });
    if (expired.length === 0) return 0;
    await this.prisma.story.updateMany({
      where: { id: { in: expired.map((s) => s.id) }, deletedAt: null },
      data: { deletedAt: now },
    });
    await this.media.softDelete(expired.map((s) => s.mediaId));
    return expired.length;
  }

  private async group(rows: StoryRow[], viewerId?: string): Promise<StoryGroupDto[]> {
    const viewed = viewerId
      ? new Set(
          (
            await this.prisma.storyView.findMany({
              where: { viewerId, storyId: { in: rows.map((r) => r.id) } },
              select: { storyId: true },
            })
          ).map((v) => v.storyId),
        )
      : new Set<string>();
    const groups = new Map<string, StoryDto[]>();
    for (const row of rows) {
      const dto = await this.toDto(row, viewerId, viewed);
      const list = groups.get(row.authorId) ?? [];
      list.push(dto);
      groups.set(row.authorId, list);
    }
    const result = [...groups.values()].map((stories) => ({
      author: stories[0]!.author,
      stories,
      hasUnviewed: stories.some((s) => !s.viewed),
    }));
    // Ordre : ses propres stories, puis non vues, puis les plus récentes.
    const latest = (g: StoryGroupDto) => g.stories[g.stories.length - 1]!.createdAt;
    return result.sort((a, b) => {
      if (a.author.id === viewerId) return -1;
      if (b.author.id === viewerId) return 1;
      if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;
      return latest(b).localeCompare(latest(a));
    });
  }

  private async toDto(
    row: StoryRow,
    viewerId: string | undefined,
    viewed: Set<string>,
  ): Promise<StoryDto> {
    const isAuthor = row.authorId === viewerId;
    const product =
      row.product && !row.product.deletedAt
        ? { id: row.product.id, title: row.product.title, priceCents: row.product.priceCents }
        : null;
    return {
      id: row.id,
      author: await this.presenter.summary(row.author),
      media: await this.media.toDto(row.media),
      caption: row.caption,
      product,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      viewed: isAuthor || viewed.has(row.id),
      viewsCount: isAuthor ? row.viewsCount : null,
    };
  }
}
