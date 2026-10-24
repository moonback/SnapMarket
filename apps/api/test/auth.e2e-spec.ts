import { createTestApp, createUser, TestContext } from './harness';

describe('Authentification (e2e)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const password = 'Correct-Horse-9';

  it('inscrit un utilisateur, hache le mot de passe et envoie un email de vérification', async () => {
    const res = await ctx.http
      .post('/api/v1/auth/register')
      .send({ email: 'Alice@Example.FR', username: 'alice', password, acceptTerms: true })
      .expect(201);
    expect(res.body.user.email).toBe('alice@example.fr');
    expect(res.body.user.role).toBe('USER');
    expect(res.body.user.emailVerified).toBe(false);
    expect(res.body.tokens.accessToken).toBeDefined();
    const stored = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'alice@example.fr' },
    });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(password);
    expect(ctx.mail.sent.at(-1)?.to).toBe('alice@example.fr');
  });

  it('refuse un rôle transmis par le client et les champs inconnus', async () => {
    await ctx.http
      .post('/api/v1/auth/register')
      .send({
        email: 'evil@example.fr',
        username: 'evil',
        password,
        acceptTerms: true,
        role: 'ADMIN',
      })
      .expect(400);
    expect(await ctx.prisma.user.count({ where: { email: 'evil@example.fr' } })).toBe(0);
  });

  it('refuse un email ou un pseudonyme déjà utilisé', async () => {
    await ctx.http
      .post('/api/v1/auth/register')
      .send({ email: 'alice@example.fr', username: 'alice2', password, acceptTerms: true })
      .expect(409);
    await ctx.http
      .post('/api/v1/auth/register')
      .send({ email: 'other@example.fr', username: 'ALICE', password, acceptTerms: true })
      .expect(409);
  });

  it('vérifie l’adresse email avec un jeton à usage unique', async () => {
    const token = ctx.mail.lastToken();
    await ctx.http.post('/api/v1/auth/verify-email').send({ token }).expect(204);
    await ctx.http.post('/api/v1/auth/verify-email').send({ token }).expect(400);
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'alice@example.fr' } });
    expect(u.emailVerifiedAt).not.toBeNull();
  });

  it('connecte, puis verrouille le compte après des échecs répétés', async () => {
    await ctx.http
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.fr', password })
      .expect(200);
    for (let i = 0; i < 5; i++) {
      await ctx.http
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.fr', password: 'nope' })
        .expect(401);
    }
    const locked = await ctx.http
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.fr', password });
    expect(locked.status).toBe(403);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    await ctx.prisma.user.update({
      where: { email: 'alice@example.fr' },
      data: { lockedUntil: null },
    });
  });

  it('renvoie la même erreur pour un compte inexistant', async () => {
    const res = await ctx.http
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.fr', password })
      .expect(401);
    expect(res.body.message).toBe('Email ou mot de passe incorrect');
  });

  it('fait tourner les refresh tokens et révoque la famille en cas de réutilisation', async () => {
    const login = await ctx.http
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.fr', password })
      .expect(200);
    const first = login.body.tokens.refreshToken as string;
    const r1 = await ctx.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first })
      .expect(200);
    const second = r1.body.refreshToken as string;
    expect(second).not.toBe(first);
    // Réutilisation de l'ancien jeton : détection de vol, toute la famille est révoquée.
    await ctx.http.post('/api/v1/auth/refresh').send({ refreshToken: first }).expect(401);
    await ctx.http.post('/api/v1/auth/refresh').send({ refreshToken: second }).expect(401);
  });

  it('déconnecte en révoquant le refresh token', async () => {
    const login = await ctx.http
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.fr', password })
      .expect(200);
    await ctx.http
      .post('/api/v1/auth/logout')
      .send({ refreshToken: login.body.tokens.refreshToken })
      .expect(204);
    await ctx.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.tokens.refreshToken })
      .expect(401);
  });

  it('réinitialise le mot de passe sans révéler l’existence du compte', async () => {
    await ctx.http
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@example.fr' })
      .expect(202);
    const before = ctx.mail.sent.length;
    await ctx.http
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'alice@example.fr' })
      .expect(202);
    expect(ctx.mail.sent.length).toBe(before + 1);
    const token = ctx.mail.lastToken();
    await ctx.http
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'weak' })
      .expect(400);
    await ctx.http
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'New-Password-42' })
      .expect(204);
    await ctx.http
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.fr', password })
      .expect(401);
    await ctx.http
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.fr', password: 'New-Password-42' })
      .expect(200);
  });

  it('rejette un jeton d’accès invalide et un compte suspendu', async () => {
    await ctx.http.get('/api/v1/users/me').set('Authorization', 'Bearer abc.def.ghi').expect(401);
    await ctx.http.get('/api/v1/users/me').expect(401);
    const bob = await createUser(ctx);
    await ctx.http.get('/api/v1/users/me').set(bob.auth).expect(200);
    await ctx.prisma.user.update({ where: { id: bob.id }, data: { status: 'SUSPENDED' } });
    await ctx.http.get('/api/v1/users/me').set(bob.auth).expect(401);
  });

  it('supprime le compte en anonymisant les données personnelles', async () => {
    const carol = await createUser(ctx, { password: 'Carol-Password-1' });
    await ctx.http
      .delete('/api/v1/users/me')
      .set(carol.auth)
      .send({ password: 'mauvais' })
      .expect(401);
    await ctx.http
      .delete('/api/v1/users/me')
      .set(carol.auth)
      .send({ password: 'Carol-Password-1' })
      .expect(204);
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: carol.id } });
    expect(u.status).toBe('DELETED');
    expect(u.email).not.toBe(carol.email);
    expect(u.passwordHash).toBeNull();
    await ctx.http.get(`/api/v1/users/${carol.id}`).expect(404);
  });
});
