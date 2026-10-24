import { CheckoutService } from '../src/orders/checkout.service';
import { OrdersService } from '../src/orders/orders.service';
import { PaymentsService } from '../src/payments/payments.service';
import { signStripePayload } from './fakes';
import {
  ADDRESS,
  createProduct,
  createTestApp,
  createUser,
  TestContext,
  TestUser,
} from './harness';

describe('Panier et paiement groupé (e2e)', () => {
  let ctx: TestContext;
  let sellerA: TestUser;
  let sellerB: TestUser;
  let buyer: TestUser;
  let seq = 0;

  beforeAll(async () => {
    ctx = await createTestApp();
    sellerA = await createUser(ctx, { payouts: true });
    sellerB = await createUser(ctx, { payouts: true });
    buyer = await createUser(ctx);
  });
  afterAll(() => ctx.close());

  function webhook(type: string, object: Record<string, unknown>) {
    const payload = JSON.stringify({
      id: `evt_cart_${++seq}`,
      object: 'event',
      type,
      data: { object },
    });
    return ctx.http
      .post('/api/v1/payments/webhooks/stripe')
      .set('stripe-signature', signStripePayload(payload))
      .set('content-type', 'application/json')
      .send(payload);
  }

  async function pay(checkoutId: string) {
    const payment = await ctx.prisma.payment.findUniqueOrThrow({
      where: { checkoutId },
      include: { checkout: true },
    });
    await webhook('payment_intent.succeeded', {
      id: payment.providerPaymentIntentId,
      object: 'payment_intent',
      amount_received: payment.checkout.totalCents,
      currency: 'eur',
      latest_charge: `ch_cart_${seq}`,
    }).expect(200);
    return payment;
  }

  const put = (user: TestUser, productId: string, body: Record<string, unknown> = {}) =>
    ctx.http.put(`/api/v1/cart/items/${productId}`).set(user.auth).send(body);

  async function emptyCart(user: TestUser) {
    await ctx.http.delete('/api/v1/cart').set(user.auth).expect(204);
  }

  it('calcule les totaux, choisit d’office le mode unique et signale ce qui bloque', async () => {
    const shoes = await createProduct(ctx, sellerA.id, {
      title: 'Baskets',
      priceCents: 3000,
      shippingFeeCents: 500,
      quantity: 3,
    });
    const lamp = await createProduct(ctx, sellerB.id, {
      title: 'Lampe',
      priceCents: 1500,
      deliveryModes: ['MEETUP'],
      shippingFeeCents: null,
    });
    await put(buyer, shoes.id, { quantity: 4 }).expect(409); // au-delà du stock
    await put(sellerA, shoes.id).expect(400); // sa propre annonce
    await put(buyer, shoes.id, { quantity: 2 }).expect(200);
    const res = await put(buyer, lamp.id).expect(200);
    const byTitle = Object.fromEntries(
      res.body.items.map((i: { product: { title: string } }) => [i.product.title, i]),
    );
    expect(byTitle.Lampe.deliveryMode).toBe('MEETUP');
    expect(byTitle.Baskets.deliveryMode).toBeNull();
    expect(byTitle.Baskets.issue).toBe('Choisissez un mode de remise');
    expect(res.body.ready).toBe(false);
    expect(res.body.sellerCount).toBe(2);

    const ready = await put(buyer, shoes.id, { quantity: 2, deliveryMode: 'SHIPPING' }).expect(200);
    expect(ready.body).toMatchObject({
      itemsTotalCents: 7500,
      shippingTotalCents: 500,
      totalCents: 8000,
      ready: true,
    });
    await put(buyer, lamp.id, { deliveryMode: 'SHIPPING' }).expect(400);
    await emptyCart(buyer);
  });

  it('crée une commande par annonce, réglées par un seul paiement, puis vide le panier', async () => {
    const a = await createProduct(ctx, sellerA.id, { priceCents: 2000, shippingFeeCents: 490 });
    const b = await createProduct(ctx, sellerB.id, {
      priceCents: 1000,
      deliveryModes: ['MEETUP'],
      shippingFeeCents: null,
    });
    await put(buyer, a.id, { deliveryMode: 'SHIPPING' }).expect(200);
    await put(buyer, b.id).expect(200);
    await ctx.http.post('/api/v1/cart/checkout').set(buyer.auth).send({}).expect(400); // adresse requise

    const res = await ctx.http
      .post('/api/v1/cart/checkout')
      .set(buyer.auth)
      .send({ shippingAddress: ADDRESS })
      .expect(201);
    const checkout = res.body.checkout;
    expect(checkout.totalCents).toBe(2490 + 1000);
    expect(checkout.orders).toHaveLength(2);
    expect(new Set(checkout.orders.map((o: { seller: { id: string } }) => o.seller.id))).toEqual(
      new Set([sellerA.id, sellerB.id]),
    );
    expect(
      checkout.orders.every(
        (o: { status: string; checkout: { orderCount: number } }) =>
          o.status === 'PENDING_PAYMENT' && o.checkout.orderCount === 2,
      ),
    ).toBe(true);
    const intent = ctx.stripe.fake.callsOf('paymentIntents.create').at(-1)!;
    expect(intent.args[0]).toMatchObject({ amount: 3490, transfer_group: checkout.id });
    expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      'RESERVED',
    );

    // Tant que le paiement n'est pas confirmé, le panier signale l'attente.
    const pending = await ctx.http.get('/api/v1/cart').set(buyer.auth).expect(200);
    expect(pending.body.items[0].issue).toContain('Paiement en attente');

    await pay(checkout.id);
    const orders = await ctx.prisma.order.findMany({ where: { checkoutId: checkout.id } });
    expect(orders.map((o) => o.status)).toEqual(['PAID', 'PAID']);
    expect(
      await ctx.prisma.ledgerEntry.count({
        where: { type: 'CHARGE', orderId: { in: orders.map((o) => o.id) } },
      }),
    ).toBe(2);
    expect((await ctx.http.get('/api/v1/cart').set(buyer.auth)).body.items).toHaveLength(0);

    // Chaque commande vit sa vie : remboursement partiel de l'une, versement de l'autre.
    const shipped = orders.find((o) => o.sellerId === sellerA.id)!;
    const meetup = orders.find((o) => o.sellerId === sellerB.id)!;
    const cancel = await ctx.http
      .post(`/api/v1/orders/${shipped.id}/cancel`)
      .set(sellerA.auth)
      .send({ reason: 'Rupture' })
      .expect(200);
    expect(cancel.body.status).toBe('REFUNDED');
    const refund = ctx.stripe.fake.callsOf('refunds.create').at(-1)!;
    expect(refund.args[0]).toMatchObject({ amount: 2490 });
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: meetup.id } })).status).toBe(
      'PAID',
    );

    const when = new Date(Date.now() + 86_400_000).toISOString();
    const m = await ctx.http
      .post(`/api/v1/orders/${meetup.id}/meetups`)
      .set(buyer.auth)
      .send({ scheduledAt: when, locationLabel: 'Place du marché' })
      .expect(201);
    await ctx.http.post(`/api/v1/meetups/${m.body.id}/accept`).set(sellerB.auth).expect(200);
    await ctx.http.post(`/api/v1/orders/${meetup.id}/confirm`).set(buyer.auth).expect(200);
    await ctx.app.get(PaymentsService).payout(meetup.id);
    const transfer = ctx.stripe.fake.callsOf('transfers.create').at(-1)!;
    expect(transfer.args[0]).toMatchObject({
      amount: 950,
      transfer_group: checkout.id,
      source_transaction: expect.stringMatching(/^ch_cart_/),
    });
  });

  it('refuse le paiement en bloc si un article n’est plus disponible (rien n’est réservé)', async () => {
    const a = await createProduct(ctx, sellerA.id, {
      deliveryModes: ['MEETUP'],
      shippingFeeCents: null,
    });
    const b = await createProduct(ctx, sellerB.id, {
      deliveryModes: ['MEETUP'],
      shippingFeeCents: null,
    });
    await put(buyer, a.id).expect(200);
    await put(buyer, b.id).expect(200);
    const rival = await createUser(ctx);
    await ctx.http
      .post('/api/v1/orders')
      .set(rival.auth)
      .send({ productId: b.id, deliveryMode: 'MEETUP' })
      .expect(201);
    const res = await ctx.http.post('/api/v1/cart/checkout').set(buyer.auth).send({}).expect(409);
    expect(res.body.code).toBe('CART_NOT_READY');
    // Même en contournant les contrôles du panier, la réservation est tout-ou-rien.
    const before = await ctx.prisma.order.count({ where: { buyerId: buyer.id } });
    await expect(
      ctx.app.get(CheckoutService).create(
        { id: buyer.id, role: 'USER', emailVerified: true },
        [
          { productId: a.id, quantity: 1, deliveryMode: 'MEETUP' },
          { productId: b.id, quantity: 1, deliveryMode: 'MEETUP' },
        ],
        undefined,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await ctx.prisma.product.findUniqueOrThrow({ where: { id: a.id } })).reservedQuantity,
    ).toBe(0);
    expect(await ctx.prisma.order.count({ where: { buyerId: buyer.id } })).toBe(before);
    await emptyCart(buyer);
  });

  it('ne vend pas deux fois un article présent dans deux paniers payés simultanément', async () => {
    const shared = await createProduct(ctx, sellerA.id, {
      deliveryModes: ['MEETUP'],
      shippingFeeCents: null,
    });
    const x = await createProduct(ctx, sellerB.id, {
      deliveryModes: ['MEETUP'],
      shippingFeeCents: null,
    });
    const y = await createProduct(ctx, sellerB.id, {
      deliveryModes: ['MEETUP'],
      shippingFeeCents: null,
    });
    const u1 = await createUser(ctx);
    const u2 = await createUser(ctx);
    await put(u1, x.id).expect(200);
    await put(u1, shared.id).expect(200);
    await put(u2, shared.id).expect(200);
    await put(u2, y.id).expect(200);
    const results = await Promise.all([
      ctx.http.post('/api/v1/cart/checkout').set(u1.auth).send({}),
      ctx.http.post('/api/v1/cart/checkout').set(u2.auth).send({}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await ctx.prisma.order.count({ where: { productId: shared.id } })).toBe(1);
    const loser = results.find((r) => r.status === 409)!;
    const loserOwn = loser === results[0] ? x : y;
    expect(
      (await ctx.prisma.product.findUniqueOrThrow({ where: { id: loserOwn.id } })).reservedQuantity,
    ).toBe(0);
  });

  it('annule tout le paiement groupé avant paiement (acheteur, vendeur ou expiration)', async () => {
    const mk = () =>
      createProduct(ctx, sellerA.id, { deliveryModes: ['MEETUP'], shippingFeeCents: null });
    const checkoutOf = async (ids: string[]) => {
      for (const id of ids) await put(buyer, id).expect(200);
      return (await ctx.http.post('/api/v1/cart/checkout').set(buyer.auth).send({}).expect(201))
        .body.checkout;
    };
    const [p1, p2] = [await mk(), await mk()];
    const c1 = await checkoutOf([p1.id, p2.id]);
    const cancelled = await ctx.http
      .post(`/api/v1/checkouts/${c1.id}/cancel`)
      .set(buyer.auth)
      .expect(200);
    expect(cancelled.body.orders.map((o: { status: string }) => o.status)).toEqual([
      'CANCELLED',
      'CANCELLED',
    ]);
    expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: p1.id } })).status).toBe(
      'ACTIVE',
    );
    await ctx.http.post(`/api/v1/checkouts/${c1.id}/cancel`).set(buyer.auth).expect(409);
    await ctx.http.get(`/api/v1/checkouts/${c1.id}`).set(sellerA.auth).expect(404);

    const c2 = await checkoutOf([p1.id, p2.id]);
    await ctx.http
      .post(`/api/v1/orders/${c2.orders[0].id}/cancel`)
      .set(sellerA.auth)
      .send({})
      .expect(200);
    const after = await ctx.prisma.order.findMany({ where: { checkoutId: c2.id } });
    expect(after.every((o) => o.status === 'CANCELLED')).toBe(true);

    const c3 = await checkoutOf([p1.id, p2.id]);
    await ctx.prisma.order.updateMany({
      where: { checkoutId: c3.id },
      data: { paymentExpiresAt: new Date(Date.now() - 1000) },
    });
    const cancelsBefore = ctx.stripe.fake.callsOf('paymentIntents.cancel').length;
    expect(await ctx.app.get(OrdersService).expireUnpaid()).toBe(2);
    expect(ctx.stripe.fake.callsOf('paymentIntents.cancel').length).toBe(cancelsBefore + 1);
    await emptyCart(buyer);
  });

  it('reprend le paiement et met en litige toutes les commandes en cas de contestation bancaire', async () => {
    const a = await createProduct(ctx, sellerA.id, {
      deliveryModes: ['MEETUP'],
      shippingFeeCents: null,
    });
    const b = await createProduct(ctx, sellerB.id, {
      deliveryModes: ['MEETUP'],
      shippingFeeCents: null,
    });
    await put(buyer, a.id).expect(200);
    await put(buyer, b.id).expect(200);
    const { checkout } = (
      await ctx.http.post('/api/v1/cart/checkout').set(buyer.auth).send({}).expect(201)
    ).body;
    const resumed = await ctx.http
      .get(`/api/v1/checkouts/${checkout.id}/payment`)
      .set(buyer.auth)
      .expect(200);
    expect(resumed.body.paymentClientSecret).toContain('_secret_');
    const payment = await pay(checkout.id);
    await ctx.http.get(`/api/v1/checkouts/${checkout.id}/payment`).set(buyer.auth).expect(409);
    await webhook('charge.dispute.created', {
      id: 'dp_test_cart',
      object: 'dispute',
      amount: checkout.totalCents,
      reason: 'fraudulent',
      payment_intent: payment.providerPaymentIntentId,
    }).expect(200);
    const orders = await ctx.prisma.order.findMany({
      where: { checkoutId: checkout.id },
      include: { dispute: true },
    });
    expect(orders.map((o) => o.status)).toEqual(['DISPUTED', 'DISPUTED']);
    expect(orders.every((o) => o.dispute?.providerDisputeId === 'dp_test_cart')).toBe(true);
  });
});
