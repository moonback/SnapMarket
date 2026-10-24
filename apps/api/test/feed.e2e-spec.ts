import {
  createCategory,
  createProduct,
  createTestApp,
  createUser,
  TestContext,
  TestUser,
} from './harness';

const HOUR = 3_600_000;

describe('Flux « Pour vous » (e2e)', () => {
  let ctx: TestContext;
  let seller: TestUser;
  let viewer: TestUser;
  let shoes: { id: string };
  let books: { id: string };
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    seller = await createUser(ctx);
    viewer = await createUser(ctx);
    shoes = await createCategory(ctx, { name: 'Chaussures' });
    books = await createCategory(ctx, { name: 'Livres' });
    const now = Date.now();
    const make = async (key: string, data: Parameters<typeof createProduct>[2]) => {
      ids[key] = (await createProduct(ctx, seller.id, { title: `Article ${key}`, ...data })).id;
    };
    // Annonce « appréciée » : catégorie mise en favori par le spectateur.
    await make('liked', {
      categoryId: shoes.id,
      brand: 'Other',
      publishedAt: new Date(now - 100 * HOUR),
    });
    await make('shoeOld', {
      categoryId: shoes.id,
      brand: 'Nike',
      publishedAt: new Date(now - 30 * HOUR),
    });
    await make('bookNew', { categoryId: books.id, publishedAt: new Date(now - 1 * HOUR) });
    await make('bookMid', { categoryId: books.id, publishedAt: new Date(now - 10 * HOUR) });
    await make('nikeBook', {
      categoryId: books.id,
      brand: ' nike ',
      publishedAt: new Date(now - 20 * HOUR),
    });
    await make('shoeVeryOld', { categoryId: shoes.id, publishedAt: new Date(now - 60 * HOUR) });
    const fav = await createProduct(ctx, seller.id, {
      title: 'Favori Nike',
      categoryId: shoes.id,
      brand: 'NIKE',
      publishedAt: new Date(now - 200 * HOUR),
    });
    ids.fav = fav.id;
    await ctx.http.put(`/api/v1/favorites/${fav.id}`).set(viewer.auth).expect(204);
  });
  afterAll(() => ctx.close());

  const titles = (body: { items: { title: string }[] }) =>
    body.items.map((i) => i.title.replace('Article ', ''));

  it('expose les signaux utilisés', async () => {
    const res = await ctx.http.get('/api/v1/feed/personalization').set(viewer.auth).expect(200);
    expect(res.body).toEqual({
      enabled: true,
      categories: [{ id: shoes.id, name: 'Chaussures' }],
      brands: ['nike'],
      boostHours: { FAVORITE_CATEGORY: 48, FAVORITE_BRAND: 24 },
    });
    await ctx.http.get('/api/v1/feed/personalization').expect(401);
  });

  it('avance les annonces correspondantes d’une durée fixe et explique pourquoi', async () => {
    const res = await ctx.http
      .get('/api/v1/feed')
      .query({ q: 'Article', limit: 50 })
      .set(viewer.auth)
      .expect(200);
    // Scores (heures avant maintenant, plus petit = plus haut) :
    // shoeOld -30+48+24 = +42 ; nikeBook -20+24 = +4 ; bookNew -1 ; bookMid -10 ;
    // shoeVeryOld -60+48 = -12 ; liked -100+48 = -52
    expect(titles(res.body)).toEqual([
      'shoeOld',
      'nikeBook',
      'bookNew',
      'bookMid',
      'shoeVeryOld',
      'liked',
    ]);
    const reasons = Object.fromEntries(
      res.body.items.map((i: { title: string; matchReasons: string[] }) => [
        i.title.replace('Article ', ''),
        i.matchReasons,
      ]),
    );
    expect(reasons.shoeOld).toEqual(['FAVORITE_CATEGORY', 'FAVORITE_BRAND']);
    expect(reasons.nikeBook).toEqual(['FAVORITE_BRAND']);
    expect(reasons.bookNew).toEqual([]);
  });

  it('pagine par curseur sans doublon ni omission', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await ctx.http
        .get('/api/v1/feed')
        .query({ q: 'Article', limit: 2, ...(cursor ? { cursor } : {}) })
        .set(viewer.auth)
        .expect(200);
      seen.push(...titles(res.body));
      cursor = res.body.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(['shoeOld', 'nikeBook', 'bookNew', 'bookMid', 'shoeVeryOld', 'liked']);
  });

  it('applique les filtres et neutralise les jokers de recherche', async () => {
    const filtered = await ctx.http
      .get('/api/v1/feed')
      .query({ categoryId: books.id, q: 'Article' })
      .set(viewer.auth)
      .expect(200);
    expect(titles(filtered.body)).toEqual(['nikeBook', 'bookNew', 'bookMid']);
    const wildcard = await ctx.http
      .get('/api/v1/feed')
      .query({ q: '%' })
      .set(viewer.auth)
      .expect(200);
    expect(wildcard.body.items).toHaveLength(0);
    const injection = await ctx.http
      .get('/api/v1/feed')
      .query({ q: '\'; DROP TABLE "Product"; --' })
      .set(viewer.auth)
      .expect(200);
    expect(injection.body.items).toHaveLength(0);
    expect(await ctx.prisma.product.count()).toBeGreaterThan(0);
  });

  it('revient à l’ordre chronologique pour un visiteur ou si la personnalisation est désactivée', async () => {
    const chrono = ['bookNew', 'bookMid', 'nikeBook', 'shoeOld', 'shoeVeryOld', 'liked'];
    const anon = await ctx.http.get('/api/v1/feed').query({ q: 'Article' }).expect(200);
    expect(titles(anon.body)).toEqual(chrono);
    const me = await ctx.http
      .patch('/api/v1/users/me')
      .set(viewer.auth)
      .send({ personalizedFeed: false })
      .expect(200);
    expect(me.body.personalizedFeed).toBe(false);
    const off = await ctx.http
      .get('/api/v1/feed')
      .query({ q: 'Article' })
      .set(viewer.auth)
      .expect(200);
    expect(titles(off.body)).toEqual(chrono);
    expect(off.body.items[0].matchReasons).toBeUndefined();
    await ctx.http
      .patch('/api/v1/users/me')
      .set(viewer.auth)
      .send({ personalizedFeed: true })
      .expect(200);
  });

  it('exclut toujours ses propres annonces et les comptes bloqués', async () => {
    const own = await ctx.http
      .get('/api/v1/feed')
      .query({ q: 'Article' })
      .set(seller.auth)
      .expect(200);
    expect(own.body.items).toHaveLength(0);
    await ctx.http.post(`/api/v1/users/${seller.id}/block`).set(viewer.auth).expect(204);
    const blocked = await ctx.http
      .get('/api/v1/feed')
      .query({ q: 'Article' })
      .set(viewer.auth)
      .expect(200);
    expect(blocked.body.items).toHaveLength(0);
  });
});
