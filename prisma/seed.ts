/**
 * Seed de développement.
 *  - Crée toujours les catégories par défaut (idempotent).
 *  - Crée des données de DÉMONSTRATION clairement identifiées (préfixe « [DEMO] »,
 *    emails en @demo.snapmarket.invalid) uniquement hors production.
 * Les comptes de démonstration n'ont pas de mot de passe utilisable sauf si
 * SEED_DEMO_PASSWORD est fourni.
 */
import { PrismaClient, ProductCondition } from '@prisma/client';
import * as argon2 from 'argon2';
import { DEFAULT_CATEGORIES } from './categories';

const prisma = new PrismaClient();

const DEMO_PRODUCTS: {
  title: string;
  category: string;
  price: number;
  condition: ProductCondition;
  brand?: string;
  city: string;
  postal: string;
}[] = [
  {
    title: 'Veste en jean oversize',
    category: 'mode-accessoires',
    price: 3500,
    condition: 'VERY_GOOD',
    brand: "Levi's",
    city: 'Paris',
    postal: '75011',
  },
  {
    title: 'Baskets running taille 42',
    category: 'sport-loisirs',
    price: 4500,
    condition: 'GOOD',
    brand: 'Asics',
    city: 'Lyon',
    postal: '69003',
  },
  {
    title: 'Console portable + 3 jeux',
    category: 'informatique-jeux-video',
    price: 18000,
    condition: 'VERY_GOOD',
    brand: 'Nintendo',
    city: 'Marseille',
    postal: '13006',
  },
  {
    title: 'Lampe de bureau vintage',
    category: 'maison-decoration',
    price: 2500,
    condition: 'GOOD',
    city: 'Nantes',
    postal: '44000',
  },
  {
    title: 'Lot de romans policiers',
    category: 'livres-culture',
    price: 1200,
    condition: 'GOOD',
    city: 'Bordeaux',
    postal: '33000',
  },
  {
    title: 'Poussette compacte',
    category: 'enfants',
    price: 9000,
    condition: 'VERY_GOOD',
    city: 'Lille',
    postal: '59000',
  },
  {
    title: 'Écouteurs sans fil',
    category: 'telephones-electronique',
    price: 6000,
    condition: 'NEW',
    city: 'Toulouse',
    postal: '31000',
  },
  {
    title: 'Palette de maquillage neuve',
    category: 'beaute',
    price: 1800,
    condition: 'NEW_WITH_TAGS',
    city: 'Paris',
    postal: '75018',
  },
];

async function main(): Promise<void> {
  for (const c of DEFAULT_CATEGORIES) {
    await prisma.category.upsert({ where: { slug: c.slug }, create: c, update: {} });
  }
  console.log(`Catégories : ${DEFAULT_CATEGORIES.length}`);

  if (process.env.NODE_ENV === 'production') {
    console.log('Production : aucune donnée de démonstration créée.');
    return;
  }

  const password = process.env.SEED_DEMO_PASSWORD;
  const passwordHash = password ? await argon2.hash(password, { type: argon2.argon2id }) : null;
  const sellers = [];
  for (const name of ['demo_lea', 'demo_karim', 'demo_ines']) {
    sellers.push(
      await prisma.user.upsert({
        where: { email: `${name}@demo.snapmarket.invalid` },
        create: {
          email: `${name}@demo.snapmarket.invalid`,
          username: name,
          displayName: `[DEMO] ${name.replace('demo_', '')}`,
          bio: 'Compte de démonstration généré par le seed.',
          passwordHash,
          emailVerifiedAt: new Date(),
          termsAcceptedAt: new Date(),
        },
        update: {},
      }),
    );
  }
  const categories = new Map((await prisma.category.findMany()).map((c) => [c.slug, c.id]));
  let created = 0;
  for (const [i, p] of DEMO_PRODUCTS.entries()) {
    const title = `[DEMO] ${p.title}`;
    if (await prisma.product.findFirst({ where: { title } })) continue;
    await prisma.product.create({
      data: {
        sellerId: sellers[i % sellers.length]!.id,
        categoryId: categories.get(p.category)!,
        title,
        description: 'Annonce de démonstration générée par le script de seed. Aucun article réel.',
        priceCents: p.price,
        condition: p.condition,
        brand: p.brand ?? null,
        deliveryModes: i % 2 ? ['MEETUP'] : ['SHIPPING', 'MEETUP'],
        shippingFeeCents: i % 2 ? null : 590,
        city: p.city,
        postalCode: p.postal,
        status: 'ACTIVE',
        publishedAt: new Date(Date.now() - i * 3600_000),
      },
    });
    created++;
  }
  console.log(`Données de démonstration : ${sellers.length} comptes, ${created} annonces créées.`);
  if (!password)
    console.log(
      'Astuce : définir SEED_DEMO_PASSWORD pour pouvoir se connecter aux comptes de démo.',
    );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
