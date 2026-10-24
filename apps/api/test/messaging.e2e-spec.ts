import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import {
  createProduct,
  createReadyMedia,
  createTestApp,
  createUser,
  TestContext,
  TestUser,
} from './harness';

describe('Messagerie (e2e)', () => {
  let ctx: TestContext;
  let seller: TestUser;
  let buyer: TestUser;
  let stranger: TestUser;
  let conversationId: string;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0);
    url = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as AddressInfo).port}`;
    seller = await createUser(ctx);
    buyer = await createUser(ctx);
    stranger = await createUser(ctx);
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await ctx.close();
  });

  function connect(token?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const s = io(url, {
        auth: token ? { token } : {},
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(s);
      s.on('connect', () => {
        // La déconnexion par le serveur suit immédiatement une authentification refusée.
        setTimeout(() => (s.connected ? resolve(s) : reject(new Error('disconnected'))), 150);
      });
      s.on('connect_error', reject);
    });
  }

  function emit<T = unknown>(
    s: Socket,
    event: string,
    payload: unknown,
  ): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
    return new Promise((resolve) => s.emit(event, payload, resolve));
  }

  it('ouvre une conversation liée à une annonce (une seule par paire et annonce)', async () => {
    const product = await createProduct(ctx, seller.id);
    const a = await ctx.http
      .post('/api/v1/conversations')
      .set(buyer.auth)
      .send({ productId: product.id })
      .expect(201);
    const b = await ctx.http
      .post('/api/v1/conversations')
      .set(buyer.auth)
      .send({ productId: product.id })
      .expect(201);
    expect(a.body.id).toBe(b.body.id);
    expect(a.body.otherUser.id).toBe(seller.id);
    expect(a.body.product.id).toBe(product.id);
    conversationId = a.body.id;
    await ctx.http
      .post('/api/v1/conversations')
      .set(seller.auth)
      .send({ productId: product.id })
      .expect(400);
  });

  it('envoie des messages de façon idempotente et compte les non-lus', async () => {
    const send = () =>
      ctx.http
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set(buyer.auth)
        .send({ body: 'Bonjour, toujours disponible ?', clientMessageId: 'client-msg-0001' })
        .expect(201);
    const [m1, m2] = await Promise.all([send(), send()]);
    expect(m1.body.id).toBe(m2.body.id);
    expect(await ctx.prisma.message.count({ where: { conversationId } })).toBe(1);

    const unread = await ctx.http
      .get('/api/v1/conversations/unread-count')
      .set(seller.auth)
      .expect(200);
    expect(unread.body.count).toBe(1);
    const list = await ctx.http.get('/api/v1/conversations').set(seller.auth).expect(200);
    expect(list.body.items[0].unreadCount).toBe(1);
    expect(list.body.items[0].lastMessage.body).toBe('Bonjour, toujours disponible ?');

    await ctx.http
      .post(`/api/v1/conversations/${conversationId}/read`)
      .set(seller.auth)
      .expect(204);
    expect(
      (await ctx.http.get('/api/v1/conversations/unread-count').set(seller.auth)).body.count,
    ).toBe(0);
    const history = await ctx.http
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set(buyer.auth)
      .expect(200);
    expect(history.body.items[0].readByOther).toBe(true);
    // Notification créée pour le destinataire.
    expect(
      await ctx.prisma.notification.count({ where: { userId: seller.id, type: 'NEW_MESSAGE' } }),
    ).toBe(1);
  });

  it('interdit l’accès aux non-participants', async () => {
    await ctx.http.get(`/api/v1/conversations/${conversationId}`).set(stranger.auth).expect(404);
    await ctx.http
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set(stranger.auth)
      .expect(404);
    await ctx.http
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(stranger.auth)
      .send({ body: 'hey' })
      .expect(404);
  });

  it('refuse les messages de spam et n’accepte que des photos de messagerie du même auteur', async () => {
    const res = await ctx.http
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(buyer.auth)
      .send({
        body: 'Payez par Western Union, voir bit.ly/xyz et https://a.b https://c.d https://e.f',
      })
      .expect(422);
    expect(res.body.code).toBe('MESSAGE_REJECTED');
    const foreign = await createReadyMedia(ctx, seller.id, 'MESSAGE');
    await ctx.http
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(buyer.auth)
      .send({ mediaId: foreign.id })
      .expect(400);
    const mine = await createReadyMedia(ctx, buyer.id, 'MESSAGE');
    const photo = await ctx.http
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(buyer.auth)
      .send({ mediaId: mine.id })
      .expect(201);
    expect(photo.body.type).toBe('IMAGE');
    expect(photo.body.media.url).toContain('signed=1'); // média privé : URL signée, pas de CDN public
  });

  describe('WebSocket', () => {
    it('refuse une connexion sans jeton valide', async () => {
      await expect(connect()).rejects.toThrow();
      await expect(connect('not-a-jwt')).rejects.toThrow();
    });

    it('n’autorise pas à rejoindre une conversation dont on n’est pas membre', async () => {
      const s = await connect(stranger.token);
      const res = await emit(s, 'conversation:join', { conversationId });
      expect(res.ok).toBe(false);
      expect(res.status).toBe(404);
      const send = await emit(s, 'message:send', { conversationId, body: 'intrusion' });
      expect(send.ok).toBe(false);
    });

    it('diffuse les nouveaux messages aux membres connectés', async () => {
      const sellerSocket = await connect(seller.token);
      const buyerSocket = await connect(buyer.token);
      expect((await emit(sellerSocket, 'conversation:join', { conversationId })).ok).toBe(true);
      expect((await emit(buyerSocket, 'conversation:join', { conversationId })).ok).toBe(true);
      const received = new Promise<{ body: string }>((resolve) =>
        sellerSocket.once('message:new', resolve),
      );
      const ack = await emit<{ id: string }>(buyerSocket, 'message:send', {
        conversationId,
        body: 'Je peux passer demain',
        clientMessageId: 'socket-msg-0001',
      });
      expect(ack.ok).toBe(true);
      expect((await received).body).toBe('Je peux passer demain');
      // Rejeu du même identifiant client : même message.
      const replay = await emit<{ id: string }>(buyerSocket, 'message:send', {
        conversationId,
        body: 'Je peux passer demain',
        clientMessageId: 'socket-msg-0001',
      });
      expect(replay.data?.id).toBe(ack.data?.id);
    });
  });

  it('bloque la messagerie entre utilisateurs bloqués', async () => {
    await ctx.http.post(`/api/v1/users/${buyer.id}/block`).set(seller.auth).expect(204);
    await ctx.http
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(buyer.auth)
      .send({ body: 'Allô ?' })
      .expect(403);
    await ctx.http
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(seller.auth)
      .send({ body: 'Non' })
      .expect(403);
    const conv = await ctx.http
      .get(`/api/v1/conversations/${conversationId}`)
      .set(seller.auth)
      .expect(200);
    expect(conv.body.blocked).toBe(true);
    await ctx.http
      .post('/api/v1/conversations')
      .set(buyer.auth)
      .send({ userId: seller.id })
      .expect(403);
  });
});
