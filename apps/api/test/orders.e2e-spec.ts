import { PaymentsService } from '../src/payments/payments.service';
import { OrdersService } from '../src/orders/orders.service';
import { signStripePayload } from './fakes';
import {
  ADDRESS,
  createProduct,
  createTestApp,
  createUser,
  TestContext,
  TestUser,
} from './harness';

describe('Commandes et paiements (e2e)', () => {
  let ctx: TestContext;
  let seller: TestUser;
  let buyer: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    seller = await createUser(ctx, { payouts: true });
    buyer = await createUser(ctx);
    admin = await createUser(ctx, { role: 'ADMIN' });
  });
  afterAll(() => ctx.close());

  /** Envoie un webhook signé avec le secret de test (vérification de signature réelle). */
  function webhook(event: Record<string, unknown>) {
    const payload = JSON.stringify(event);
    return ctx.http
      .post('/api/v1/payments/webhooks/stripe')
      .set('stripe-signature', signStripePayload(payload))
      .set('content-type', 'application/json')
      .send(payload);
  }

  let eventSeq = 0;
  async function paymentSucceeded(orderId: string, expected = 200, amount?: number) {
    const { checkoutId } = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const payment = await ctx.prisma.payment.findUniqueOrThrow({
      where: { checkoutId },
      include: { checkout: true },
    });
    return webhook({
      id: `evt_test_${++eventSeq}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: payment.providerPaymentIntentId,
          object: 'payment_intent',
          amount_received: amount ?? payment.checkout.totalCents,
          currency: 'eur',
          latest_charge: `ch_test_${eventSeq}`,
        },
      },
    }).expect(expected);
  }

  function order(productId: string, mode: 'SHIPPING' | 'MEETUP' = 'SHIPPING', user = buyer) {
    return ctx.http
      .post('/api/v1/orders')
      .set(user.auth)
      .send({
        productId,
        deliveryMode: mode,
        ...(mode === 'SHIPPING' ? { shippingAddress: ADDRESS } : {}),
      });
  }

  it('calcule le prix côté serveur et ignore toute valeur transmise par le client', async () => {
    const p = await createProduct(ctx, seller.id, { priceCents: 2000, shippingFeeCents: 490 });
    const res = await ctx.http.post('/api/v1/orders').set(buyer.auth).send({
      productId: p.id,
      deliveryMode: 'SHIPPING',
      shippingAddress: ADDRESS,
      priceCents: 1,
      sellerId: buyer.id,
    });
    expect(res.status).toBe(400); // champs non autorisés refusés
    const ok = await order(p.id).expect(201);
    expect(ok.body.order.pricing).toEqual({
      itemPriceCents: 2000,
      shippingFeeCents: 490,
      totalCents: 2490,
      commissionCents: 100,
      commissionBps: 500,
      sellerPayoutCents: 2390,
    });
    expect(ok.body.order.seller.id).toBe(seller.id);
    expect(ok.body.order.status).toBe('PENDING_PAYMENT');
    expect(ok.body.paymentClientSecret).toContain('_secret_');
    const intent = ctx.stripe.fake.callsOf('paymentIntents.create').at(-1)!;
    expect((intent.args[0] as { amount: number }).amount).toBe(2490);
    expect((intent.args[1] as { idempotencyKey: string }).idempotencyKey).toBe(
      `checkout-${ok.body.order.checkout.id}-payment-intent`,
    );
    const product = await ctx.prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(product.status).toBe('RESERVED');
    expect(product.reservedQuantity).toBe(1);
  });

  it('refuse l’auto-achat, une adresse manquante et un mode de livraison non proposé', async () => {
    const p = await createProduct(ctx, seller.id, {
      deliveryModes: ['MEETUP'],
      shippingFeeCents: null,
    });
    await order(p.id, 'MEETUP', seller).expect(400);
    await order(p.id, 'SHIPPING').expect(400);
    await ctx.http
      .post('/api/v1/orders')
      .set(buyer.auth)
      .send({ productId: p.id, deliveryMode: 'SHIPPING' })
      .expect(400);
  });

  it('refuse le paiement si le vendeur n’a pas activé les versements', async () => {
    const noPayout = await createUser(ctx);
    const p = await createProduct(ctx, noPayout.id);
    const res = await order(p.id).expect(409);
    expect(res.body.code).toBe('SELLER_PAYOUTS_NOT_READY');
  });

  it('renvoie 503 quand le paiement n’est pas configuré, sans réserver le produit', async () => {
    ctx.stripe.enabled = false;
    try {
      const p = await createProduct(ctx, seller.id);
      const res = await order(p.id).expect(503);
      expect(res.body.code).toBe('PAYMENTS_UNAVAILABLE');
      expect(
        (await ctx.prisma.product.findUniqueOrThrow({ where: { id: p.id } })).reservedQuantity,
      ).toBe(0);
      const detail = await ctx.http.get(`/api/v1/products/${p.id}`).set(buyer.auth).expect(200);
      expect(detail.body.purchase.available).toBe(false);
    } finally {
      ctx.stripe.enabled = true;
    }
  });

  it('empêche deux achats concurrents du même article', async () => {
    const p = await createProduct(ctx, seller.id, { quantity: 1 });
    const buyers = await Promise.all([
      createUser(ctx),
      createUser(ctx),
      createUser(ctx),
      createUser(ctx),
    ]);
    const results = await Promise.all(buyers.map((b) => order(p.id, 'SHIPPING', b)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409]);
    expect(await ctx.prisma.order.count({ where: { productId: p.id } })).toBe(1);
  });

  it('annule la commande et libère le stock si l’initialisation du paiement échoue', async () => {
    const p = await createProduct(ctx, seller.id);
    ctx.stripe.fake.failNextPaymentIntent = true;
    await order(p.id).expect(502);
    const o = await ctx.prisma.order.findFirstOrThrow({ where: { productId: p.id } });
    expect(o.status).toBe('CANCELLED');
    const product = await ctx.prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(product.status).toBe('ACTIVE');
    expect(product.reservedQuantity).toBe(0);
  });

  describe('webhooks', () => {
    it('refuse un webhook non signé ou mal signé', async () => {
      await ctx.http.post('/api/v1/payments/webhooks/stripe').send({ id: 'evt_x' }).expect(400);
      const payload = JSON.stringify({
        id: 'evt_bad',
        type: 'payment_intent.succeeded',
        data: { object: {} },
      });
      await ctx.http
        .post('/api/v1/payments/webhooks/stripe')
        .set('stripe-signature', signStripePayload(payload, 'whsec_wrong'))
        .set('content-type', 'application/json')
        .send(payload)
        .expect(400);
    });

    it('marque la commande payée uniquement via webhook signé, de façon idempotente', async () => {
      const p = await createProduct(ctx, seller.id);
      const created = await order(p.id).expect(201);
      const id = created.body.order.id;
      // Aucun endpoint client ne permet de déclarer une commande payée.
      await ctx.http.post(`/api/v1/orders/${id}/confirm`).set(buyer.auth).expect(409);

      const payment = await ctx.prisma.payment.findUniqueOrThrow({
        where: { checkoutId: created.body.order.checkout.id },
      });
      const event = {
        id: 'evt_test_idempotent',
        object: 'event',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: payment.providerPaymentIntentId,
            object: 'payment_intent',
            amount_received: 2490,
            currency: 'eur',
            latest_charge: 'ch_test_idem',
          },
        },
      };
      const first = await webhook(event).expect(200);
      expect(first.body.duplicate).toBe(false);
      const second = await webhook(event).expect(200);
      expect(second.body.duplicate).toBe(true);

      const o = await ctx.prisma.order.findUniqueOrThrow({
        where: { id },
        include: { statusEvents: true, checkout: { include: { payment: true } } },
      });
      expect(o.status).toBe('PAID');
      expect(o.checkout.payment?.status).toBe('SUCCEEDED');
      expect(o.statusEvents.filter((e) => e.to === 'PAID')).toHaveLength(1);
      expect(await ctx.prisma.ledgerEntry.count({ where: { orderId: id, type: 'CHARGE' } })).toBe(
        1,
      );
    });

    it('rejette un montant reçu incohérent', async () => {
      const p = await createProduct(ctx, seller.id);
      const created = await order(p.id).expect(201);
      await paymentSucceeded(created.body.order.id, 500, 1);
      const o = await ctx.prisma.order.findUniqueOrThrow({ where: { id: created.body.order.id } });
      expect(o.status).toBe('PENDING_PAYMENT');
      const event = await ctx.prisma.paymentEvent.findFirstOrThrow({
        where: { error: { not: null } },
      });
      expect(event.processedAt).toBeNull();
    });

    it('rembourse automatiquement un paiement arrivé après l’expiration de la commande', async () => {
      const p = await createProduct(ctx, seller.id);
      const created = await order(p.id).expect(201);
      const id = created.body.order.id;
      await ctx.prisma.order.update({
        where: { id },
        data: { paymentExpiresAt: new Date(Date.now() - 1000) },
      });
      expect(await ctx.app.get(OrdersService).expireUnpaid()).toBe(1);
      expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe(
        'CANCELLED',
      );
      expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
        'ACTIVE',
      );
      const refundsBefore = ctx.stripe.fake.callsOf('refunds.create').length;
      await paymentSucceeded(id, 200);
      expect(ctx.stripe.fake.callsOf('refunds.create').length).toBe(refundsBefore + 1);
    });
  });

  describe('livraison', () => {
    let id: string;
    let productId: string;

    beforeAll(async () => {
      const p = await createProduct(ctx, seller.id, { priceCents: 3000, shippingFeeCents: 500 });
      productId = p.id;
      const created = await order(p.id).expect(201);
      id = created.body.order.id;
      await paymentSucceeded(id, 200);
    });

    it('applique la machine à états (acteurs et ordre des étapes)', async () => {
      await ctx.http.post(`/api/v1/orders/${id}/ship`).set(seller.auth).send({}).expect(409); // pas encore en préparation
      await ctx.http.post(`/api/v1/orders/${id}/preparing`).set(buyer.auth).expect(403);
      await ctx.http.post(`/api/v1/orders/${id}/preparing`).set(seller.auth).expect(200);
      await ctx.http.post(`/api/v1/orders/${id}/confirm`).set(buyer.auth).expect(409);
      const shipped = await ctx.http
        .post(`/api/v1/orders/${id}/ship`)
        .set(seller.auth)
        .send({ carrier: 'Colissimo', trackingNumber: '6A12345678901' })
        .expect(200);
      expect(shipped.body.status).toBe('SHIPPED');
      expect(shipped.body.shipment.trackingNumber).toBe('6A12345678901');
      expect(shipped.body.allowedTransitions).toEqual([]); // vue vendeur
      const asBuyer = await ctx.http.get(`/api/v1/orders/${id}`).set(buyer.auth).expect(200);
      expect(asBuyer.body.allowedTransitions.sort()).toEqual(['COMPLETED', 'DISPUTED']);
    });

    it('n’expose pas la commande à un tiers', async () => {
      const stranger = await createUser(ctx);
      await ctx.http.get(`/api/v1/orders/${id}`).set(stranger.auth).expect(404);
    });

    it('termine la commande à la confirmation de l’acheteur puis transfère au vendeur', async () => {
      await ctx.http.post(`/api/v1/orders/${id}/confirm`).set(seller.auth).expect(403);
      const done = await ctx.http.post(`/api/v1/orders/${id}/confirm`).set(buyer.auth).expect(200);
      expect(done.body.status).toBe('COMPLETED');
      expect(done.body.transferStatus).toBe('PENDING');
      const product = await ctx.prisma.product.findUniqueOrThrow({ where: { id: productId } });
      expect(product.status).toBe('SOLD');
      expect(product.soldQuantity).toBe(1);

      // Exécution du transfert (normalement par le worker).
      await ctx.app.get(PaymentsService).payout(id);
      await ctx.app.get(PaymentsService).payout(id); // idempotent
      const transfers = ctx.stripe.fake
        .callsOf('transfers.create')
        .filter((c) => (c.args[0] as { metadata: { orderId: string } }).metadata.orderId === id);
      expect(transfers).toHaveLength(1);
      expect(transfers[0]!.args[0]).toMatchObject({
        amount: 3350,
        currency: 'eur',
        destination: expect.stringMatching(/^acct_test_/),
        source_transaction: expect.stringMatching(/^ch_test_/),
      });
      const ledger = await ctx.prisma.ledgerEntry.findMany({ where: { orderId: id } });
      expect(ledger.find((l) => l.type === 'TRANSFER')?.amountCents).toBe(3350);
      expect(ledger.find((l) => l.type === 'COMMISSION')?.amountCents).toBe(150);
      const o = await ctx.prisma.order.findUniqueOrThrow({ where: { id } });
      expect(o.transferStatus).toBe('SUCCEEDED');
    });

    it('autorise un seul avis par participant et uniquement après la transaction', async () => {
      await ctx.http
        .post(`/api/v1/orders/${id}/reviews`)
        .set(buyer.auth)
        .send({ rating: 5, comment: 'Parfait' })
        .expect(201);
      await ctx.http
        .post(`/api/v1/orders/${id}/reviews`)
        .set(buyer.auth)
        .send({ rating: 1 })
        .expect(409);
      await ctx.http
        .post(`/api/v1/orders/${id}/reviews`)
        .set(seller.auth)
        .send({ rating: 4 })
        .expect(201);
      const stranger = await createUser(ctx);
      await ctx.http
        .post(`/api/v1/orders/${id}/reviews`)
        .set(stranger.auth)
        .send({ rating: 1 })
        .expect(404);
      const profile = await ctx.http.get(`/api/v1/users/${seller.id}`).expect(200);
      expect(profile.body.rating).toEqual({ count: 1, average: 5 });
      expect(profile.body.soldCount).toBeGreaterThanOrEqual(1);

      const p = await createProduct(ctx, seller.id);
      const pending = await order(p.id).expect(201);
      await ctx.http
        .post(`/api/v1/orders/${pending.body.order.id}/reviews`)
        .set(buyer.auth)
        .send({ rating: 5 })
        .expect(403);
    });
  });

  describe('annulations et remboursements', () => {
    it('l’acheteur peut annuler avant paiement, pas après', async () => {
      const p = await createProduct(ctx, seller.id);
      const a = await order(p.id).expect(201);
      const cancelled = await ctx.http
        .post(`/api/v1/orders/${a.body.order.id}/cancel`)
        .set(buyer.auth)
        .send({})
        .expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
        'ACTIVE',
      );

      const b = await order(p.id).expect(201);
      await paymentSucceeded(b.body.order.id, 200);
      await ctx.http
        .post(`/api/v1/orders/${b.body.order.id}/cancel`)
        .set(buyer.auth)
        .send({})
        .expect(403);
    });

    it('le vendeur qui annule après paiement déclenche un remboursement intégral sans commission', async () => {
      const p = await createProduct(ctx, seller.id);
      const created = await order(p.id).expect(201);
      const id = created.body.order.id;
      await paymentSucceeded(id, 200);
      const res = await ctx.http
        .post(`/api/v1/orders/${id}/cancel`)
        .set(seller.auth)
        .send({ reason: 'Article abîmé' })
        .expect(200);
      expect(res.body.status).toBe('REFUNDED');
      const refund = ctx.stripe.fake.callsOf('refunds.create').at(-1)!;
      expect((refund.args[1] as { idempotencyKey: string }).idempotencyKey).toBe(
        `order-${id}-refund`,
      );
      expect(
        await ctx.prisma.ledgerEntry.count({ where: { orderId: id, type: 'COMMISSION' } }),
      ).toBe(0);
      expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
        'ACTIVE',
      );
    });
  });

  describe('remise en main propre', () => {
    it('propose, accepte, puis confirme la remise (jamais automatique)', async () => {
      const p = await createProduct(ctx, seller.id);
      const created = await order(p.id, 'MEETUP').expect(201);
      const id = created.body.order.id;
      expect(created.body.order.pricing.shippingFeeCents).toBe(0);
      const when = new Date(Date.now() + 2 * 86_400_000).toISOString();
      await ctx.http
        .post(`/api/v1/orders/${id}/meetups`)
        .set(buyer.auth)
        .send({ scheduledAt: when, locationLabel: 'Gare de Lyon, hall 1' })
        .expect(409); // pas payée
      await paymentSucceeded(id, 200);
      const m = await ctx.http
        .post(`/api/v1/orders/${id}/meetups`)
        .set(buyer.auth)
        .send({ scheduledAt: when, locationLabel: 'Gare de Lyon, hall 1' })
        .expect(201);
      await ctx.http.post(`/api/v1/meetups/${m.body.id}/accept`).set(buyer.auth).expect(403); // le proposant ne peut pas accepter
      await ctx.http.post(`/api/v1/meetups/${m.body.id}/accept`).set(seller.auth).expect(200);
      let o = await ctx.http.get(`/api/v1/orders/${id}`).set(buyer.auth).expect(200);
      expect(o.body.status).toBe('READY_FOR_HANDOFF');

      // Annulation du rendez-vous accepté : retour à PAID.
      await ctx.http.post(`/api/v1/meetups/${m.body.id}/cancel`).set(seller.auth).expect(200);
      o = await ctx.http.get(`/api/v1/orders/${id}`).set(buyer.auth).expect(200);
      expect(o.body.status).toBe('PAID');

      const m2 = await ctx.http
        .post(`/api/v1/orders/${id}/meetups`)
        .set(seller.auth)
        .send({ scheduledAt: when, locationLabel: 'Place de la République' })
        .expect(201);
      await ctx.http.post(`/api/v1/meetups/${m2.body.id}/accept`).set(buyer.auth).expect(200);
      // Le rendez-vous passé ne termine pas la commande : confirmation explicite.
      await ctx.prisma.meetup.update({
        where: { id: m2.body.id },
        data: { scheduledAt: new Date(Date.now() - 3600_000) },
      });
      o = await ctx.http.get(`/api/v1/orders/${id}`).set(buyer.auth).expect(200);
      expect(o.body.status).toBe('READY_FOR_HANDOFF');
      const done = await ctx.http.post(`/api/v1/orders/${id}/confirm`).set(buyer.auth).expect(200);
      expect(done.body.status).toBe('COMPLETED');
      expect(done.body.meetups[0].status).toBe('COMPLETED');
    });
  });

  describe('litiges', () => {
    it('l’acheteur ouvre un litige et l’administration le résout par remboursement', async () => {
      const p = await createProduct(ctx, seller.id);
      const created = await order(p.id).expect(201);
      const id = created.body.order.id;
      await paymentSucceeded(id, 200);
      await ctx.http.post(`/api/v1/orders/${id}/preparing`).set(seller.auth).expect(200);
      await ctx.http.post(`/api/v1/orders/${id}/ship`).set(seller.auth).send({}).expect(200);
      const d = await ctx.http
        .post(`/api/v1/orders/${id}/dispute`)
        .set(buyer.auth)
        .send({ reason: 'NOT_RECEIVED', details: 'Rien reçu' })
        .expect(200);
      expect(d.body.status).toBe('DISPUTED');
      await ctx.http
        .post(`/api/v1/admin/disputes/${d.body.dispute.id}/resolve`)
        .set(buyer.auth)
        .send({ resolution: 'REFUND', note: 'x' })
        .expect(403);
      const moderator = await createUser(ctx, { role: 'MODERATOR' });
      await ctx.http
        .post(`/api/v1/admin/disputes/${d.body.dispute.id}/resolve`)
        .set(moderator.auth)
        .send({ resolution: 'REFUND', note: 'x' })
        .expect(403);
      await ctx.http
        .post(`/api/v1/admin/disputes/${d.body.dispute.id}/resolve`)
        .set(admin.auth)
        .send({ resolution: 'REFUND', note: 'Colis perdu, suivi vide' })
        .expect(200);
      const o = await ctx.prisma.order.findUniqueOrThrow({
        where: { id },
        include: { dispute: true },
      });
      expect(o.status).toBe('REFUNDED');
      expect(o.dispute?.status).toBe('RESOLVED_REFUND');
      const audit = await ctx.prisma.auditLog.count({
        where: { action: 'admin.dispute_resolve', entityId: d.body.dispute.id },
      });
      expect(audit).toBe(1);
    });
  });

  describe('offres', () => {
    it('applique le prix de l’offre acceptée, une seule fois', async () => {
      const p = await createProduct(ctx, seller.id, { priceCents: 5000 });
      await ctx.http
        .post('/api/v1/offers')
        .set(buyer.auth)
        .send({ productId: p.id, amountCents: 5000 })
        .expect(400);
      await ctx.http
        .post('/api/v1/offers')
        .set(buyer.auth)
        .send({ productId: p.id, amountCents: 100 })
        .expect(400);
      const offer = await ctx.http
        .post('/api/v1/offers')
        .set(buyer.auth)
        .send({ productId: p.id, amountCents: 4000 })
        .expect(201);
      await ctx.http
        .post('/api/v1/offers')
        .set(buyer.auth)
        .send({ productId: p.id, amountCents: 4100 })
        .expect(409);
      await ctx.http.post(`/api/v1/offers/${offer.body.id}/accept`).set(buyer.auth).expect(404);
      await ctx.http.post(`/api/v1/offers/${offer.body.id}/accept`).set(seller.auth).expect(200);
      const other = await createUser(ctx);
      await ctx.http
        .post('/api/v1/orders')
        .set(other.auth)
        .send({ productId: p.id, deliveryMode: 'MEETUP', offerId: offer.body.id })
        .expect(400);
      const created = await ctx.http
        .post('/api/v1/orders')
        .set(buyer.auth)
        .send({ productId: p.id, deliveryMode: 'MEETUP', offerId: offer.body.id })
        .expect(201);
      expect(created.body.order.pricing.itemPriceCents).toBe(4000);
      expect(created.body.order.pricing.commissionCents).toBe(200);
      const used = await ctx.prisma.offer.findUniqueOrThrow({ where: { id: offer.body.id } });
      expect(used.status).toBe('USED');
    });
  });
});
