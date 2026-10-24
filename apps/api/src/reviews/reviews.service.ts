import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Paginated, ReviewDto } from '@snapmarket/shared';
import { CursorQueryDto } from '../common/dto/pagination.dto';
import { decodeCursor, pageSize, paginate } from '../common/utils/pagination';
import { SpamService } from '../moderation/spam.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { USER_SUMMARY_INCLUDE, UserPresenter } from '../users/user-presenter.service';
import { CreateReviewDto } from './dto/review.dto';

const REVIEW_WINDOW_DAYS = 60;
const REVIEW_INCLUDE = { author: { include: USER_SUMMARY_INCLUDE } } satisfies Prisma.ReviewInclude;

/**
 * Avis : uniquement pour une commande terminée, un seul par participant et par commande,
 * dans les 60 jours suivant la fin de la transaction.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presenter: UserPresenter,
    private readonly spam: SpamService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(userId: string, orderId: string, dto: CreateReviewDto): Promise<ReviewDto> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || (order.buyerId !== userId && order.sellerId !== userId)) {
      throw new NotFoundException('Commande introuvable');
    }
    if (order.status !== 'COMPLETED' || !order.completedAt) {
      throw new ForbiddenException('Un avis ne peut être laissé qu’après une transaction terminée');
    }
    if (Date.now() - order.completedAt.getTime() > REVIEW_WINDOW_DAYS * 86_400_000) {
      throw new ForbiddenException('Le délai pour laisser un avis est dépassé');
    }
    if (dto.comment) {
      const spam = await this.spam.evaluate(userId, 'review', dto.comment);
      if (spam.verdict === 'reject') throw new UnprocessableEntityException('Commentaire refusé');
    }
    const subjectId = order.buyerId === userId ? order.sellerId : order.buyerId;
    try {
      const review = await this.prisma.$transaction(async (tx) => {
        const r = await tx.review.create({
          data: {
            orderId,
            authorId: userId,
            subjectId,
            rating: dto.rating,
            comment: dto.comment || null,
          },
          include: REVIEW_INCLUDE,
        });
        await tx.user.update({
          where: { id: subjectId },
          data: { ratingCount: { increment: 1 }, ratingSum: { increment: dto.rating } },
        });
        return r;
      });
      await this.notifications.notify({
        userId: subjectId,
        type: 'REVIEW_RECEIVED',
        title: 'Nouvel avis',
        body: `Vous avez reçu une note de ${dto.rating}/5`,
        data: { orderId },
      });
      return this.toDto(review);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Vous avez déjà laissé un avis pour cette commande');
      }
      throw e;
    }
  }

  async forUser(userId: string, query: CursorQueryDto): Promise<Paginated<ReviewDto>> {
    const limit = pageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.review.findMany({
      where: {
        subjectId: userId,
        moderationStatus: 'VISIBLE',
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
      include: REVIEW_INCLUDE,
    });
    const page = paginate(rows, limit, (r) => ({ v: r.createdAt.toISOString(), id: r.id }));
    return {
      items: await Promise.all(page.items.map((r) => this.toDto(r))),
      nextCursor: page.nextCursor,
    };
  }

  private async toDto(
    r: Prisma.ReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>,
  ): Promise<ReviewDto> {
    return {
      id: r.id,
      orderId: r.orderId,
      author: await this.presenter.summary(r.author),
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
