import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FeedMatchReason, FeedPersonalization } from '@snapmarket/shared';
import { CursorPayload } from '../common/utils/pagination';
import { PrismaService } from '../prisma/prisma.service';
import type { SearchProductsDto } from '../products/dto/product.dto';

/**
 * Classement « Pour vous » — v2, transparent et déterministe.
 *
 * Signaux utilisés (uniquement des actions explicites de l'utilisateur) :
 *  - catégories des annonces mises en favori et des achats terminés (5 au plus) ;
 *  - marques des annonces mises en favori (5 au plus).
 * Aucun historique de navigation, de temps passé ou de données tierces n'est utilisé.
 *
 * Score = date de publication + avance fixe par signal correspondant :
 *  - catégorie appréciée : +48 h ; marque appréciée : +24 h (cumulables, +72 h au plus).
 * Une annonce correspondante est donc présentée comme si elle avait été publiée plus tard.
 * Le score ne dépend pas de l'heure de la requête : la pagination par curseur est stable.
 * L'utilisateur peut consulter ces signaux et désactiver la personnalisation.
 */
export const BOOST_HOURS: Record<FeedMatchReason, number> = {
  FAVORITE_CATEGORY: 48,
  FAVORITE_BRAND: 24,
};

const MAX_SIGNALS = 5;
const PURCHASE_WEIGHT = 2;

export interface FeedSignals {
  categoryIds: string[];
  brands: string[]; // en minuscules
}

export interface RankedId {
  id: string;
  score: number;
}

/** Échappe les jokers LIKE pour une recherche littérale. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function matchReasons(
  product: { categoryId: string; brand: string | null },
  signals: FeedSignals,
): FeedMatchReason[] {
  const reasons: FeedMatchReason[] = [];
  if (signals.categoryIds.includes(product.categoryId)) reasons.push('FAVORITE_CATEGORY');
  if (product.brand && signals.brands.includes(product.brand.trim().toLowerCase()))
    reasons.push('FAVORITE_BRAND');
  return reasons;
}

@Injectable()
export class PersonalizationService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { personalizedFeed: true },
    });
    return user?.personalizedFeed ?? false;
  }

  async signals(userId: string): Promise<FeedSignals> {
    const [favorites, purchases] = await Promise.all([
      this.prisma.favorite.findMany({
        where: { userId },
        select: { product: { select: { categoryId: true, brand: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.order.findMany({
        where: { buyerId: userId, status: 'COMPLETED' },
        select: { product: { select: { categoryId: true } } },
        orderBy: { completedAt: 'desc' },
        take: 100,
      }),
    ]);
    const categoryWeight = new Map<string, number>();
    const brandWeight = new Map<string, number>();
    for (const f of favorites) {
      categoryWeight.set(f.product.categoryId, (categoryWeight.get(f.product.categoryId) ?? 0) + 1);
      const brand = f.product.brand?.trim().toLowerCase();
      if (brand) brandWeight.set(brand, (brandWeight.get(brand) ?? 0) + 1);
    }
    for (const p of purchases) {
      categoryWeight.set(
        p.product.categoryId,
        (categoryWeight.get(p.product.categoryId) ?? 0) + PURCHASE_WEIGHT,
      );
    }
    // Tri par poids décroissant puis par clé : résultat déterministe en cas d'égalité.
    const top = (m: Map<string, number>) =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, MAX_SIGNALS)
        .map(([k]) => k);
    return { categoryIds: top(categoryWeight), brands: top(brandWeight) };
  }

  async describe(userId: string): Promise<FeedPersonalization> {
    const [enabled, signals] = await Promise.all([this.isEnabled(userId), this.signals(userId)]);
    const categories = await this.prisma.category.findMany({
      where: { id: { in: signals.categoryIds } },
      select: { id: true, name: true },
    });
    const order = new Map(signals.categoryIds.map((id, i) => [id, i]));
    return {
      enabled,
      categories: categories.sort((a, b) => order.get(a.id)! - order.get(b.id)!),
      brands: signals.brands,
      boostHours: BOOST_HOURS,
    };
  }

  /**
   * Identifiants classés selon le score « Pour vous », avec les mêmes conditions de
   * visibilité et les mêmes filtres que la recherche standard.
   */
  async rankedIds(
    query: SearchProductsDto,
    excludedSellerIds: string[],
    signals: FeedSignals,
    cursor: CursorPayload | null,
    take: number,
  ): Promise<RankedId[]> {
    const categoryBoost = BOOST_HOURS.FAVORITE_CATEGORY * 3_600_000;
    const brandBoost = BOOST_HOURS.FAVORITE_BRAND * 3_600_000;
    const where: Prisma.Sql[] = [
      Prisma.sql`p."status" IN ('ACTIVE', 'RESERVED')`,
      Prisma.sql`p."moderationStatus" = 'VISIBLE'`,
      Prisma.sql`p."deletedAt" IS NULL`,
      Prisma.sql`p."publishedAt" IS NOT NULL`,
      Prisma.sql`u."status" = 'ACTIVE'`,
    ];
    if (excludedSellerIds.length > 0)
      where.push(Prisma.sql`p."sellerId" <> ALL(${excludedSellerIds}::text[])`);
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      where.push(Prisma.sql`(p."title" ILIKE ${like} OR p."brand" ILIKE ${like})`);
    }
    if (query.categoryId) where.push(Prisma.sql`p."categoryId" = ${query.categoryId}`);
    if (query.minPriceCents !== undefined)
      where.push(Prisma.sql`p."priceCents" >= ${query.minPriceCents}`);
    if (query.maxPriceCents !== undefined)
      where.push(Prisma.sql`p."priceCents" <= ${query.maxPriceCents}`);
    if (query.conditions?.length)
      where.push(Prisma.sql`p."condition"::text = ANY(${query.conditions}::text[])`);
    if (query.deliveryMode)
      where.push(Prisma.sql`${query.deliveryMode}::"DeliveryMode" = ANY(p."deliveryModes")`);
    if (query.city) where.push(Prisma.sql`lower(p."city") = lower(${query.city})`);
    if (query.department)
      where.push(Prisma.sql`p."postalCode" LIKE ${`${escapeLike(query.department)}%`}`);
    if (query.sellerId) where.push(Prisma.sql`p."sellerId" = ${query.sellerId}`);

    const cursorSql = cursor
      ? Prisma.sql`WHERE t.score < ${BigInt(String(cursor.v))} OR (t.score = ${BigInt(String(cursor.v))} AND t.id < ${cursor.id})`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<{ id: string; score: bigint }[]>`
      SELECT t.id, t.score FROM (
        SELECT p."id",
          (floor(extract(epoch FROM p."publishedAt") * 1000)::bigint
            + CASE WHEN p."categoryId" = ANY(${signals.categoryIds}::text[]) THEN ${categoryBoost}::bigint ELSE 0 END
            + CASE WHEN lower(trim(p."brand")) = ANY(${signals.brands}::text[]) THEN ${brandBoost}::bigint ELSE 0 END
          ) AS score
        FROM "Product" p
        JOIN "User" u ON u."id" = p."sellerId"
        WHERE ${Prisma.join(where, ' AND ')}
      ) t
      ${cursorSql}
      ORDER BY t.score DESC, t.id DESC
      LIMIT ${take}`;
    return rows.map((r) => ({ id: r.id, score: Number(r.score) }));
  }
}
