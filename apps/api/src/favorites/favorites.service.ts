import { Injectable, NotFoundException } from '@nestjs/common';
import { Paginated, ProductSummary } from '@snapmarket/shared';
import { AuthUser } from '../common/decorators/auth.decorators';
import { CursorQueryDto } from '../common/dto/pagination.dto';
import { decodeCursor, pageSize, paginate } from '../common/utils/pagination';
import { PrismaService } from '../prisma/prisma.service';
import {
  PRODUCT_SUMMARY_INCLUDE,
  ProductsService,
  PUBLICLY_VISIBLE,
} from '../products/products.service';

/** Les favoris sont privés : seul leur propriétaire peut les consulter. */
@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  async add(userId: string, productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, ...PUBLICLY_VISIBLE },
    });
    if (!product) throw new NotFoundException('Annonce introuvable');
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.favorite.createMany({
        data: [{ userId, productId }],
        skipDuplicates: true,
      });
      if (created.count > 0) {
        await tx.product.update({
          where: { id: productId },
          data: { favoritesCount: { increment: 1 } },
        });
      }
    });
  }

  async remove(userId: string, productId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.favorite.deleteMany({ where: { userId, productId } });
      if (deleted.count > 0) {
        await tx.product.update({
          where: { id: productId },
          data: { favoritesCount: { decrement: 1 } },
        });
      }
    });
  }

  async list(user: AuthUser, query: CursorQueryDto): Promise<Paginated<ProductSummary>> {
    const limit = pageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.favorite.findMany({
      where: {
        userId: user.id,
        product: { deletedAt: null, moderationStatus: 'VISIBLE' },
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(String(cursor.v)) } },
                { createdAt: new Date(String(cursor.v)), productId: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { productId: 'desc' }],
      take: limit + 1,
      include: { product: { include: PRODUCT_SUMMARY_INCLUDE } },
    });
    const page = paginate(rows, limit, (f) => ({ v: f.createdAt.toISOString(), id: f.productId }));
    return {
      items: await Promise.all(page.items.map((f) => this.products.toSummary(f.product, true))),
      nextCursor: page.nextCursor,
    };
  }
}
