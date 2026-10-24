import {
  createCategory,
  createProduct,
  createReadyMedia,
  createTestApp,
  createUser,
  TestContext,
  TestUser,
} from './harness';

describe('Annonces, médias, favoris, stories (e2e)', () => {
  let ctx: TestContext;
  let seller: TestUser;
  let buyer: TestUser;
  let categoryId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    seller = await createUser(ctx);
    buyer = await createUser(ctx);
    categoryId = (await createCategory(ctx)).id;
  });
  afterAll(() => ctx.close());

  async function uploadImage(user: TestUser, purpose = 'PRODUCT') {
    const ticket = await ctx.http
      .post('/api/v1/media/uploads')
      .set(user.auth)
      .send({ mimeType: 'image/jpeg', sizeBytes: 2048, purpose })
      .expect(201);
    const media = await ctx.prisma.media.findUniqueOrThrow({ where: { id: ticket.body.mediaId } });
    ctx.storage.upload(media.storageKey, 2048, 'image/jpeg');
    const done = await ctx.http
      .post(`/api/v1/media/${media.id}/complete`)
      .set(user.auth)
      .expect(200);
    expect(done.body.status).toBe('PROCESSING');
    return media.id as string;
  }

  describe('médias', () => {
    it('refuse les types et tailles non autorisés', async () => {
      await ctx.http
        .post('/api/v1/media/uploads')
        .set(seller.auth)
        .send({ mimeType: 'application/pdf', sizeBytes: 100, purpose: 'PRODUCT' })
        .expect(400);
      await ctx.http
        .post('/api/v1/media/uploads')
        .set(seller.auth)
        .send({ mimeType: 'image/jpeg', sizeBytes: 11 * 1024 * 1024, purpose: 'PRODUCT' })
        .expect(400);
      await ctx.http
        .post('/api/v1/media/uploads')
        .set(seller.auth)
        .send({ mimeType: 'video/mp4', sizeBytes: 1000, purpose: 'MESSAGE', durationSeconds: 10 })
        .expect(400);
    });

    it('refuse la finalisation si le fichier réel ne correspond pas', async () => {
      const ticket = await ctx.http
        .post('/api/v1/media/uploads')
        .set(seller.auth)
        .send({ mimeType: 'image/png', sizeBytes: 500, purpose: 'PRODUCT' })
        .expect(201);
      expect(ticket.body.uploadUrl).toContain('storage.test.invalid');
      await ctx.http
        .post(`/api/v1/media/${ticket.body.mediaId}/complete`)
        .set(seller.auth)
        .expect(422);
      const media = await ctx.prisma.media.findUniqueOrThrow({
        where: { id: ticket.body.mediaId },
      });
      ctx.storage.upload(media.storageKey, 999_999, 'image/png');
      await ctx.http.post(`/api/v1/media/${media.id}/complete`).set(seller.auth).expect(422);
    });

    it('n’autorise pas un autre utilisateur à finaliser le média', async () => {
      const ticket = await ctx.http
        .post('/api/v1/media/uploads')
        .set(seller.auth)
        .send({ mimeType: 'image/jpeg', sizeBytes: 10, purpose: 'PRODUCT' })
        .expect(201);
      await ctx.http
        .post(`/api/v1/media/${ticket.body.mediaId}/complete`)
        .set(buyer.auth)
        .expect(403);
    });
  });

  describe('annonces', () => {
    let productId: string;

    it('crée un brouillon puis le publie', async () => {
      const mediaId = await uploadImage(seller);
      const res = await ctx.http
        .post('/api/v1/products')
        .set(seller.auth)
        .send({
          title: 'Sac à main cuir',
          description: 'Peu porté',
          priceCents: 4500,
          categoryId,
          condition: 'VERY_GOOD',
          brand: 'Maroquinerie',
          deliveryModes: ['SHIPPING'],
          shippingFeeCents: 590,
          mediaIds: [mediaId],
        })
        .expect(201);
      productId = res.body.id;
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.isOwner).toBe(true);
      // Un brouillon n'est pas visible publiquement.
      await ctx.http.get(`/api/v1/products/${productId}`).expect(404);
      const pub = await ctx.http
        .post(`/api/v1/products/${productId}/publish`)
        .set(seller.auth)
        .expect(200);
      expect(pub.body.status).toBe('ACTIVE');
      await ctx.http.get(`/api/v1/products/${productId}`).expect(200);
    });

    it('exige les frais de livraison quand la livraison est proposée', async () => {
      await ctx.http
        .post('/api/v1/products')
        .set(seller.auth)
        .send({
          title: 'Lampe',
          description: '',
          priceCents: 1000,
          categoryId,
          condition: 'GOOD',
          deliveryModes: ['SHIPPING'],
          mediaIds: [],
        })
        .expect(400);
    });

    it('refuse la publication sans email vérifié', async () => {
      const unverified = await createUser(ctx, { verified: false });
      const media = await createReadyMedia(ctx, unverified.id);
      await ctx.http
        .post('/api/v1/products')
        .set(unverified.auth)
        .send({
          title: 'Chaise',
          description: '',
          priceCents: 1500,
          categoryId,
          condition: 'GOOD',
          deliveryModes: ['MEETUP'],
          mediaIds: [media.id],
          publish: true,
        })
        .expect(403);
    });

    it('refuse d’utiliser le média d’un autre utilisateur', async () => {
      const media = await createReadyMedia(ctx, buyer.id);
      await ctx.http
        .post('/api/v1/products')
        .set(seller.auth)
        .send({
          title: 'Table',
          description: '',
          priceCents: 1500,
          categoryId,
          condition: 'GOOD',
          deliveryModes: ['MEETUP'],
          mediaIds: [media.id],
        })
        .expect(400);
    });

    it('contrôle la propriété lors des modifications', async () => {
      await ctx.http
        .patch(`/api/v1/products/${productId}`)
        .set(buyer.auth)
        .send({ priceCents: 100 })
        .expect(403);
      await ctx.http.delete(`/api/v1/products/${productId}`).set(buyer.auth).expect(403);
      const ok = await ctx.http
        .patch(`/api/v1/products/${productId}`)
        .set(seller.auth)
        .send({ priceCents: 4000 })
        .expect(200);
      expect(ok.body.priceCents).toBe(4000);
    });

    it('refuse un contenu de fraude manifeste', async () => {
      const media = await createReadyMedia(ctx, seller.id);
      const res = await ctx.http
        .post('/api/v1/products')
        .set(seller.auth)
        .send({
          title: 'iPhone neuf',
          description:
            'Paiement uniquement par Western Union ou coupons PCS, contact whatsapp 06 12 34 56 78',
          priceCents: 20000,
          categoryId,
          condition: 'NEW',
          deliveryModes: ['MEETUP'],
          mediaIds: [media.id],
        })
        .expect(422);
      expect(res.body.code).toBe('CONTENT_REJECTED');
    });

    it('masque les annonces des catégories soumises à validation', async () => {
      const vehicles = await createCategory(ctx, { requiresReview: true });
      const media = await createReadyMedia(ctx, seller.id);
      const res = await ctx.http
        .post('/api/v1/products')
        .set(seller.auth)
        .send({
          title: 'Scooter 50cc',
          description: '',
          priceCents: 80000,
          categoryId: vehicles.id,
          condition: 'GOOD',
          deliveryModes: ['MEETUP'],
          mediaIds: [media.id],
          publish: true,
        })
        .expect(201);
      expect(res.body.moderationStatus).toBe('HIDDEN');
      await ctx.http.get(`/api/v1/products/${res.body.id}`).set(buyer.auth).expect(404);
    });
  });

  describe('recherche et flux', () => {
    beforeAll(async () => {
      const cat = await createCategory(ctx, { slug: 'search-cat' });
      const base = Date.now();
      for (let i = 0; i < 7; i++) {
        await createProduct(ctx, seller.id, {
          categoryId: cat.id,
          title: `Basket running ${i}`,
          brand: i % 2 ? 'Adidas' : 'Nike',
          priceCents: 1000 + i * 500,
          condition: i < 3 ? 'NEW' : 'GOOD',
          deliveryModes: i % 2 ? ['MEETUP'] : ['SHIPPING'],
          postalCode: i < 4 ? '75011' : '69003',
          publishedAt: new Date(base - i * 1000),
        });
      }
    });

    it('filtre par texte, prix, état, livraison et département', async () => {
      const res = await ctx.http
        .get('/api/v1/products')
        .query({
          q: 'basket',
          minPriceCents: 1500,
          maxPriceCents: 3500,
          conditions: 'NEW,GOOD',
          deliveryMode: 'SHIPPING',
          department: '75',
        })
        .expect(200);
      const titles = res.body.items.map((p: { title: string }) => p.title).sort();
      expect(titles).toEqual(['Basket running 2']);
      const brand = await ctx.http.get('/api/v1/products').query({ q: 'adid' }).expect(200);
      expect(brand.body.items).toHaveLength(3);
    });

    it('pagine par curseur sans doublon, triée par prix', async () => {
      const seen: number[] = [];
      let cursor: string | undefined;
      do {
        const res = await ctx.http
          .get('/api/v1/products')
          .query({ q: 'basket', sort: 'price_asc', limit: 3, ...(cursor ? { cursor } : {}) })
          .expect(200);
        seen.push(...res.body.items.map((p: { priceCents: number }) => p.priceCents));
        cursor = res.body.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).toEqual([1000, 1500, 2000, 2500, 3000, 3500, 4000]);
      await ctx.http.get('/api/v1/products').query({ cursor: 'garbage' }).expect(400);
    });

    it('exclut ses propres annonces et celles des comptes bloqués du flux', async () => {
      const own = await ctx.http
        .get('/api/v1/feed')
        .query({ q: 'basket' })
        .set(seller.auth)
        .expect(200);
      expect(own.body.items).toHaveLength(0);
      const visible = await ctx.http
        .get('/api/v1/feed')
        .query({ q: 'basket' })
        .set(buyer.auth)
        .expect(200);
      expect(visible.body.items.length).toBeGreaterThan(0);
      await ctx.http.post(`/api/v1/users/${seller.id}/block`).set(buyer.auth).expect(204);
      const blocked = await ctx.http
        .get('/api/v1/feed')
        .query({ q: 'basket' })
        .set(buyer.auth)
        .expect(200);
      expect(blocked.body.items).toHaveLength(0);
      await ctx.http.delete(`/api/v1/users/${seller.id}/block`).set(buyer.auth).expect(204);
    });
  });

  describe('favoris', () => {
    it('ajoute, liste (privé) et retire un favori avec un compteur cohérent', async () => {
      const p = await createProduct(ctx, seller.id, { title: 'Montre vintage' });
      await ctx.http.put(`/api/v1/favorites/${p.id}`).set(buyer.auth).expect(204);
      await ctx.http.put(`/api/v1/favorites/${p.id}`).set(buyer.auth).expect(204);
      const list = await ctx.http.get('/api/v1/favorites').set(buyer.auth).expect(200);
      expect(list.body.items.map((i: { id: string }) => i.id)).toContain(p.id);
      expect(
        (await ctx.prisma.product.findUniqueOrThrow({ where: { id: p.id } })).favoritesCount,
      ).toBe(1);
      const detail = await ctx.http.get(`/api/v1/products/${p.id}`).set(buyer.auth).expect(200);
      expect(detail.body.isFavorite).toBe(true);
      await ctx.http.delete(`/api/v1/favorites/${p.id}`).set(buyer.auth).expect(204);
      expect(
        (await ctx.prisma.product.findUniqueOrThrow({ where: { id: p.id } })).favoritesCount,
      ).toBe(0);
      await ctx.http.get('/api/v1/favorites').expect(401);
    });
  });

  describe('stories', () => {
    it('publie une story liée à une annonce et la fait disparaître à expiration', async () => {
      const product = await createProduct(ctx, seller.id, { title: 'Story product' });
      const media = await createReadyMedia(ctx, seller.id, 'STORY');
      const res = await ctx.http
        .post('/api/v1/stories')
        .set(seller.auth)
        .send({ mediaId: media.id, productId: product.id, caption: 'Nouveauté !' })
        .expect(201);
      const expiresIn = new Date(res.body.expiresAt).getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(23.9 * 3600_000);
      expect(expiresIn).toBeLessThanOrEqual(24 * 3600_000);

      const feed = await ctx.http.get('/api/v1/stories').set(buyer.auth).expect(200);
      const group = feed.body.find((g: { author: { id: string } }) => g.author.id === seller.id);
      expect(group.hasUnviewed).toBe(true);
      expect(group.stories[0].viewsCount).toBeNull(); // compteur réservé à l'auteur

      await ctx.http.post(`/api/v1/stories/${res.body.id}/view`).set(buyer.auth).expect(204);
      await ctx.http.post(`/api/v1/stories/${res.body.id}/view`).set(buyer.auth).expect(204);
      const mine = await ctx.http
        .get(`/api/v1/stories/user/${seller.id}`)
        .set(seller.auth)
        .expect(200);
      expect(mine.body.stories[0].viewsCount).toBe(1);

      // Expiration simulée en base : la story disparaît même sans nettoyage asynchrone.
      await ctx.prisma.story.update({
        where: { id: res.body.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const after = await ctx.http.get('/api/v1/stories').set(buyer.auth).expect(200);
      expect(
        after.body.find((g: { author: { id: string } }) => g.author.id === seller.id),
      ).toBeUndefined();
      await ctx.http.post(`/api/v1/stories/${res.body.id}/view`).set(buyer.auth).expect(404);
    });

    it('interdit de lier la story à l’annonce d’un autre et de supprimer celle d’un autre', async () => {
      const foreign = await createProduct(ctx, buyer.id);
      const media = await createReadyMedia(ctx, seller.id, 'STORY');
      await ctx.http
        .post('/api/v1/stories')
        .set(seller.auth)
        .send({ mediaId: media.id, productId: foreign.id })
        .expect(400);
      const story = await ctx.http
        .post('/api/v1/stories')
        .set(seller.auth)
        .send({ mediaId: media.id })
        .expect(201);
      await ctx.http.delete(`/api/v1/stories/${story.body.id}`).set(buyer.auth).expect(403);
      await ctx.http.delete(`/api/v1/stories/${story.body.id}`).set(seller.auth).expect(204);
    });
  });
});
