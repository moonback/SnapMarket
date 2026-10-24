import { Injectable, Logger } from '@nestjs/common';
import { Order, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { AuditService } from '../audit/audit.service';
import { OrderStateService } from '../orders/order-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';

/**
 * Paiements — Stripe Connect, modèle « separate charges and transfers » :
 *  1. L'acheteur paie la plateforme (PaymentIntent, transfer_group = id de commande).
 *  2. Les fonds restent sur le solde de la plateforme jusqu'à la fin de la transaction.
 *  3. À la complétion, un Transfer (source_transaction = charge) verse au compte
 *     Express du vendeur le montant dû ; la différence constitue la commission.
 *  4. Remboursement : Refund du PaymentIntent (avec annulation préalable du transfert
 *     s'il a déjà eu lieu).
 * L'état « payé » n'est jamais déclaré par le client : seul un webhook signé le fait.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly orderState: OrderStateService,
    private readonly audit: AuditService,
  ) {}

  get available(): boolean {
    return this.stripeService.configured;
  }

  async createPaymentIntent(order: Order): Promise<string> {
    const intent = await this.stripeService.stripe.paymentIntents.create(
      {
        amount: order.totalCents,
        currency: 'eur',
        automatic_payment_methods: { enabled: true },
        transfer_group: order.id,
        description: `SnapMarket ${order.reference}`,
        metadata: { orderId: order.id, reference: order.reference },
      },
      { idempotencyKey: `order-${order.id}-payment-intent` },
    );
    if (!intent.client_secret) throw new Error('PaymentIntent sans client_secret');
    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        providerPaymentIntentId: intent.id,
        amountCents: order.totalCents,
        status: 'REQUIRES_PAYMENT',
      },
    });
    return intent.client_secret;
  }

  async clientSecret(orderId: string): Promise<string> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { orderId } });
    const intent = await this.stripeService.stripe.paymentIntents.retrieve(
      payment.providerPaymentIntentId,
    );
    if (!intent.client_secret) throw new Error('PaymentIntent sans client_secret');
    return intent.client_secret;
  }

  async cancelPaymentIntent(orderId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { orderId } });
    if (!payment || !this.available) return;
    try {
      await this.stripeService.stripe.paymentIntents.cancel(payment.providerPaymentIntentId);
    } catch (e) {
      // Un PaymentIntent déjà réussi ne peut pas être annulé : le webhook traitera le remboursement.
      this.logger.warn(`Annulation du PaymentIntent impossible (${orderId}) : ${String(e)}`);
    }
    await this.prisma.payment.updateMany({
      where: { orderId, status: { in: ['REQUIRES_PAYMENT', 'PROCESSING', 'FAILED'] } },
      data: { status: 'CANCELED' },
    });
  }

  /**
   * Remboursement intégral. Si le vendeur a déjà été payé, le transfert est d'abord annulé.
   * Retourne l'identifiant du remboursement Stripe.
   */
  async refundInFull(order: Order, reason: string): Promise<string> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    const stripe = this.stripeService.stripe;
    if (order.stripeTransferId && order.transferStatus === 'SUCCEEDED') {
      const reversal = await stripe.transfers.createReversal(
        order.stripeTransferId,
        { amount: order.sellerPayoutCents, metadata: { orderId: order.id } },
        { idempotencyKey: `order-${order.id}-transfer-reversal` },
      );
      await this.prisma.$transaction([
        this.prisma.order.update({ where: { id: order.id }, data: { transferStatus: 'REVERSED' } }),
        this.prisma.ledgerEntry.create({
          data: {
            orderId: order.id,
            type: 'TRANSFER_REVERSAL',
            amountCents: order.sellerPayoutCents,
            providerRef: reversal.id,
          },
        }),
      ]);
    }
    const refund = await stripe.refunds.create(
      {
        payment_intent: payment.providerPaymentIntentId,
        metadata: { orderId: order.id, reason: reason.slice(0, 200) },
      },
      { idempotencyKey: `order-${order.id}-refund` },
    );
    await this.prisma.ledgerEntry.upsert({
      where: { type_providerRef: { type: 'REFUND', providerRef: refund.id } },
      create: {
        orderId: order.id,
        type: 'REFUND',
        amountCents: refund.amount,
        providerRef: refund.id,
        note: refund.status ?? null,
      },
      update: {},
    });
    return refund.id;
  }

  /** Transfert des fonds au vendeur (exécuté par le worker, avec reprises). */
  async payout(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { payment: true, seller: { include: { sellerProfile: true } } },
    });
    if (order.status !== 'COMPLETED' || order.transferStatus === 'SUCCEEDED') return;
    if (order.transferStatus !== 'PENDING' && order.transferStatus !== 'FAILED') return;
    const accountId = order.seller.sellerProfile?.stripeAccountId;
    const chargeId = order.payment?.latestChargeId;
    if (!accountId || !chargeId) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { transferStatus: 'FAILED' },
      });
      throw new Error(`Transfert impossible pour ${orderId} : compte vendeur ou charge manquant`);
    }
    try {
      const transfer = await this.stripeService.stripe.transfers.create(
        {
          amount: order.sellerPayoutCents,
          currency: 'eur',
          destination: accountId,
          source_transaction: chargeId,
          transfer_group: order.id,
          metadata: { orderId: order.id, reference: order.reference },
        },
        { idempotencyKey: `order-${order.id}-transfer` },
      );
      await this.prisma.$transaction([
        this.prisma.order.update({
          where: { id: orderId },
          data: { transferStatus: 'SUCCEEDED', stripeTransferId: transfer.id },
        }),
        this.prisma.ledgerEntry.create({
          data: {
            orderId,
            type: 'TRANSFER',
            amountCents: transfer.amount,
            providerRef: transfer.id,
          },
        }),
        // La commission est enregistrée uniquement une fois le transfert effectué.
        this.prisma.ledgerEntry.create({
          data: {
            orderId,
            type: 'COMMISSION',
            amountCents: order.totalCents - transfer.amount,
            providerRef: `commission:${transfer.id}`,
          },
        }),
      ]);
    } catch (e) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { transferStatus: 'FAILED' },
      });
      throw e;
    }
  }

  // ------------------------------------------------------------------
  // Webhooks
  // ------------------------------------------------------------------

  /** Traitement idempotent : un même événement Stripe n'est appliqué qu'une seule fois. */
  async handleEvent(event: Stripe.Event): Promise<{ duplicate: boolean }> {
    const existing = await this.prisma.paymentEvent.findUnique({
      where: { providerEventId: event.id },
    });
    if (existing?.processedAt) return { duplicate: true };
    const record =
      existing ??
      (await this.prisma.paymentEvent
        .create({
          data: {
            providerEventId: event.id,
            type: event.type,
            payload: event as unknown as Prisma.InputJsonValue,
          },
        })
        .catch(async (e: unknown) => {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return this.prisma.paymentEvent.findUniqueOrThrow({
              where: { providerEventId: event.id },
            });
          }
          throw e;
        }));
    if (record.processedAt) return { duplicate: true };

    try {
      const orderId = await this.dispatch(event);
      await this.prisma.paymentEvent.update({
        where: { id: record.id },
        data: { processedAt: new Date(), orderId: orderId ?? undefined, error: null },
      });
      return { duplicate: false };
    } catch (e) {
      await this.prisma.paymentEvent.update({
        where: { id: record.id },
        data: { error: String(e).slice(0, 1000) },
      });
      throw e;
    }
  }

  private async dispatch(event: Stripe.Event): Promise<string | null> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        return this.onPaymentSucceeded(event.data.object);
      case 'payment_intent.processing':
        return this.updatePaymentStatus(event.data.object, 'PROCESSING');
      case 'payment_intent.payment_failed':
        return this.updatePaymentStatus(event.data.object, 'FAILED');
      case 'payment_intent.canceled':
        return this.onPaymentCanceled(event.data.object);
      case 'charge.refunded':
        return this.onChargeRefunded(event.data.object);
      case 'charge.dispute.created':
        return this.onDisputeCreated(event.data.object);
      case 'account.updated':
        await this.onAccountUpdated(event.data.object);
        return null;
      default:
        return null;
    }
  }

  private async paymentFor(intent: Stripe.PaymentIntent) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerPaymentIntentId: intent.id },
      include: { order: true },
    });
    if (!payment) {
      this.logger.warn(`PaymentIntent inconnu : ${intent.id}`);
      return null;
    }
    return payment;
  }

  private async onPaymentSucceeded(intent: Stripe.PaymentIntent): Promise<string | null> {
    const payment = await this.paymentFor(intent);
    if (!payment) return null;
    const order = payment.order;
    // Contrôle de cohérence : montant et devise reçus doivent correspondre à la commande.
    if (intent.amount_received !== order.totalCents || intent.currency !== 'eur') {
      await this.audit.log({
        actorId: null,
        action: 'payment.amount_mismatch',
        entityType: 'Order',
        entityId: order.id,
        metadata: {
          expected: order.totalCents,
          received: intent.amount_received,
          currency: intent.currency,
        },
      });
      throw new Error(`Montant reçu incohérent pour la commande ${order.id}`);
    }
    const chargeId =
      typeof intent.latest_charge === 'string'
        ? intent.latest_charge
        : (intent.latest_charge?.id ?? null);
    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCEEDED', latestChargeId: chargeId },
      }),
      this.prisma.ledgerEntry.upsert({
        where: { type_providerRef: { type: 'CHARGE', providerRef: chargeId ?? intent.id } },
        create: {
          orderId: order.id,
          type: 'CHARGE',
          amountCents: intent.amount_received,
          providerRef: chargeId ?? intent.id,
        },
        update: {},
      }),
    ]);

    if (order.status === 'PENDING_PAYMENT') {
      await this.orderState.transition({
        orderId: order.id,
        to: 'PAID',
        actor: 'SYSTEM',
        actorId: null,
        note: 'Paiement confirmé par le prestataire',
        expectedFrom: 'PENDING_PAYMENT',
      });
    } else if (order.status === 'CANCELLED') {
      // Paiement arrivé après l'expiration de la commande : remboursement automatique.
      await this.refundInFull(order, 'Paiement reçu après annulation de la commande');
      await this.audit.log({
        actorId: null,
        action: 'payment.late_refund',
        entityType: 'Order',
        entityId: order.id,
      });
    }
    return order.id;
  }

  private async updatePaymentStatus(
    intent: Stripe.PaymentIntent,
    status: 'PROCESSING' | 'FAILED',
  ): Promise<string | null> {
    const payment = await this.paymentFor(intent);
    if (!payment) return null;
    await this.prisma.payment.updateMany({
      where: { id: payment.id, status: { notIn: ['SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
      data: { status },
    });
    return payment.orderId;
  }

  private async onPaymentCanceled(intent: Stripe.PaymentIntent): Promise<string | null> {
    const payment = await this.paymentFor(intent);
    if (!payment) return null;
    await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'CANCELED' } });
    if (payment.order.status === 'PENDING_PAYMENT') {
      await this.orderState.transition({
        orderId: payment.orderId,
        to: 'CANCELLED',
        actor: 'SYSTEM',
        actorId: null,
        note: 'Paiement annulé',
        expectedFrom: 'PENDING_PAYMENT',
      });
    }
    return payment.orderId;
  }

  private async onChargeRefunded(charge: Stripe.Charge): Promise<string | null> {
    const intentId =
      typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (!intentId) return null;
    const payment = await this.prisma.payment.findUnique({
      where: { providerPaymentIntentId: intentId },
    });
    if (!payment) return null;
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        refundedCents: charge.amount_refunded,
        status: charge.amount_refunded >= payment.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      },
    });
    return payment.orderId;
  }

  private async onDisputeCreated(dispute: Stripe.Dispute): Promise<string | null> {
    const intentId =
      typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : dispute.payment_intent?.id;
    if (!intentId) return null;
    const payment = await this.prisma.payment.findUnique({
      where: { providerPaymentIntentId: intentId },
      include: { order: true },
    });
    if (!payment) return null;
    const order = payment.order;
    await this.prisma.ledgerEntry.upsert({
      where: { type_providerRef: { type: 'DISPUTE', providerRef: dispute.id } },
      create: {
        orderId: order.id,
        type: 'DISPUTE',
        amountCents: dispute.amount,
        providerRef: dispute.id,
        note: dispute.reason,
      },
      update: {},
    });
    if (['PAID', 'PREPARING', 'SHIPPED', 'READY_FOR_HANDOFF', 'COMPLETED'].includes(order.status)) {
      await this.orderState.transition({
        orderId: order.id,
        to: 'DISPUTED',
        actor: 'SYSTEM',
        actorId: null,
        note: `Contestation bancaire : ${dispute.reason}`,
        extra: async (tx) => {
          await tx.dispute.upsert({
            where: { orderId: order.id },
            create: {
              orderId: order.id,
              reason: 'CHARGEBACK',
              details: dispute.reason,
              providerDisputeId: dispute.id,
            },
            update: { providerDisputeId: dispute.id, status: 'OPEN' },
          });
        },
      });
    }
    return order.id;
  }

  private async onAccountUpdated(account: Stripe.Account): Promise<void> {
    await this.prisma.sellerProfile.updateMany({
      where: { stripeAccountId: account.id },
      data: {
        stripeChargesEnabled: account.charges_enabled ?? false,
        // Les transferts nécessitent la capacité « transfers » active et des virements possibles.
        stripePayoutsEnabled:
          (account.payouts_enabled ?? false) && account.capabilities?.transfers === 'active',
        stripeDetailsSubmitted: account.details_submitted ?? false,
      },
    });
  }
}
