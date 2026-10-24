import { createProduct, createTestApp, createUser, TestContext, TestUser } from './harness';

describe('Signalements, modération et administration (e2e)', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let moderator: TestUser;
  let seller: TestUser;
  let user: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createUser(ctx, { role: 'ADMIN' });
    moderator = await createUser(ctx, { role: 'MODERATOR' });
    seller = await createUser(ctx);
    user = await createUser(ctx);
  });
  afterAll(() => ctx.close());

  it('réserve l’administration aux rôles habilités', async () => {
    await ctx.http.get('/api/v1/admin/dashboard').set(user.auth).expect(403);
    await ctx.http.get('/api/v1/admin/dashboard').expect(401);
    await ctx.http.get('/api/v1/admin/dashboard').set(moderator.auth).expect(200);
    await ctx.http.get('/api/v1/admin/audit-logs').set(moderator.auth).expect(403);
    await ctx.http.get('/api/v1/admin/audit-logs').set(admin.auth).expect(200);
  });

  it('n’attribue jamais le rôle ADMIN via l’API', async () => {
    await ctx.http
      .post(`/api/v1/admin/users/${user.id}/role`)
      .set(admin.auth)
      .send({ role: 'ADMIN' })
      .expect(400);
    await ctx.http
      .post(`/api/v1/admin/users/${user.id}/role`)
      .set(moderator.auth)
      .send({ role: 'MODERATOR' })
      .expect(403);
    await ctx.http.patch('/api/v1/users/me').set(user.auth).send({ role: 'ADMIN' }).expect(400);
    const ok = await ctx.http
      .post(`/api/v1/admin/users/${user.id}/role`)
      .set(admin.auth)
      .send({ role: 'MODERATOR' })
      .expect(200);
    expect(ok.body.role).toBe('MODERATOR');
    await ctx.http
      .post(`/api/v1/admin/users/${user.id}/role`)
      .set(admin.auth)
      .send({ role: 'USER' })
      .expect(200);
  });

  it('un modérateur ne peut pas suspendre un administrateur ; une suspension coupe l’accès', async () => {
    await ctx.http
      .post(`/api/v1/admin/users/${admin.id}/status`)
      .set(moderator.auth)
      .send({ status: 'BANNED' })
      .expect(403);
    const target = await createUser(ctx);
    await ctx.http
      .post(`/api/v1/admin/users/${target.id}/status`)
      .set(moderator.auth)
      .send({ status: 'SUSPENDED', reason: 'Spam' })
      .expect(200);
    await ctx.http.get('/api/v1/users/me').set(target.auth).expect(401);
    const actions = await ctx.prisma.moderationAction.count({
      where: { targetId: target.id, action: 'SUSPEND_USER' },
    });
    expect(actions).toBe(1);
  });

  it('masque automatiquement un contenu après plusieurs signalements distincts', async () => {
    const product = await createProduct(ctx, seller.id, { title: 'Contrefaçon évidente' });
    const reporters = await Promise.all([createUser(ctx), createUser(ctx), createUser(ctx)]);
    await ctx.http
      .post('/api/v1/reports')
      .set(seller.auth)
      .send({ targetType: 'PRODUCT', targetId: product.id, reason: 'COUNTERFEIT' })
      .expect(404);
    for (const [i, r] of reporters.entries()) {
      await ctx.http
        .post('/api/v1/reports')
        .set(r.auth)
        .send({ targetType: 'PRODUCT', targetId: product.id, reason: 'COUNTERFEIT' })
        .expect(201);
      if (i === 0) {
        await ctx.http
          .post('/api/v1/reports')
          .set(r.auth)
          .send({ targetType: 'PRODUCT', targetId: product.id, reason: 'SPAM' })
          .expect(409);
      }
    }
    const p = await ctx.prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(p.moderationStatus).toBe('HIDDEN');
    await ctx.http.get(`/api/v1/products/${product.id}`).set(user.auth).expect(404);

    const reports = await ctx.http.get('/api/v1/admin/reports').set(moderator.auth).expect(200);
    const report = reports.body.items.find((r: { targetId: string }) => r.targetId === product.id);
    expect(report.target.title).toBe('Contrefaçon évidente');
    const res = await ctx.http
      .post(`/api/v1/admin/reports/${report.id}/resolve`)
      .set(moderator.auth)
      .send({ status: 'RESOLVED', contentAction: 'REMOVE', note: 'Contrefaçon confirmée' })
      .expect(200);
    expect(res.body.closed).toBe(3);
    expect(
      (await ctx.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).moderationStatus,
    ).toBe('REMOVED');
    expect(
      await ctx.prisma.notification.count({ where: { userId: seller.id, type: 'MODERATION' } }),
    ).toBe(1);
  });

  it('valide les paramètres métier et journalise leur modification', async () => {
    await ctx.http
      .patch('/api/v1/admin/settings')
      .set(admin.auth)
      .send({ commissionBps: 99999 })
      .expect(400);
    await ctx.http
      .patch('/api/v1/admin/settings')
      .set(admin.auth)
      .send({ unknownKey: 1 })
      .expect(400);
    await ctx.http
      .patch('/api/v1/admin/settings')
      .set(moderator.auth)
      .send({ commissionBps: 700 })
      .expect(403);
    const res = await ctx.http
      .patch('/api/v1/admin/settings')
      .set(admin.auth)
      .send({ commissionBps: 700 })
      .expect(200);
    expect(res.body.commissionBps).toBe(700);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'settings.update' } })).toBe(1);
  });

  it('vérifie manuellement un vendeur professionnel (aucun badge sans validation)', async () => {
    await ctx.http
      .post('/api/v1/sellers/me/pro-request')
      .set(seller.auth)
      .send({
        companyName: 'Boutique Test',
        siret: '12345678901234',
        legalAddress: {
          fullName: 'Boutique Test',
          line1: '1 rue A',
          postalCode: '75001',
          city: 'Paris',
          country: 'FR',
        },
      })
      .expect(400); // SIRET invalide (clé de Luhn)
    await ctx.http
      .post('/api/v1/sellers/me/pro-request')
      .set(seller.auth)
      .send({
        companyName: 'Boutique Test',
        siret: '73282932000074',
        legalAddress: {
          fullName: 'Boutique Test',
          line1: '1 rue A',
          postalCode: '75001',
          city: 'Paris',
          country: 'FR',
        },
      })
      .expect(201);
    let profile = await ctx.http.get(`/api/v1/users/${seller.id}`).expect(200);
    expect(profile.body.accountType).toBe('PROFESSIONAL');
    expect(profile.body.proVerified).toBe(false);
    await ctx.http
      .post(`/api/v1/admin/sellers/${seller.id}/decision`)
      .set(moderator.auth)
      .send({ decision: 'VERIFIED' })
      .expect(200);
    profile = await ctx.http.get(`/api/v1/users/${seller.id}`).expect(200);
    expect(profile.body.proVerified).toBe(true);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: seller.id } })).role).toBe(
      'PRO_SELLER',
    );
  });

  it('gère les catégories (administrateur uniquement)', async () => {
    await ctx.http
      .post('/api/v1/admin/categories')
      .set(moderator.auth)
      .send({ slug: 'vinyles', name: 'Vinyles' })
      .expect(403);
    const c = await ctx.http
      .post('/api/v1/admin/categories')
      .set(admin.auth)
      .send({ slug: 'vinyles', name: 'Vinyles' })
      .expect(201);
    await ctx.http
      .patch(`/api/v1/admin/categories/${c.body.id}`)
      .set(admin.auth)
      .send({ isActive: false })
      .expect(200);
    const pub = await ctx.http.get('/api/v1/categories').expect(200);
    expect(pub.body.find((x: { slug: string }) => x.slug === 'vinyles')).toBeUndefined();
  });
});
