import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';
import { APP_CONFIG, AppConfig } from '../config/configuration';

/**
 * Accès à Stripe. Si STRIPE_SECRET_KEY est absent, toute opération de paiement
 * renvoie 503 : aucun paiement n'est simulé.
 */
@Injectable()
export class StripeService {
  private client: Stripe | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get configured(): boolean {
    return this.config.stripe.secretKey !== null && this.config.stripe.webhookSecret !== null;
  }

  get stripe(): Stripe {
    if (!this.configured) {
      throw new ServiceUnavailableException({
        message: 'Le paiement en ligne n’est pas encore disponible',
        code: 'PAYMENTS_UNAVAILABLE',
      });
    }
    this.client ??= new Stripe(this.config.stripe.secretKey!, {
      maxNetworkRetries: 2,
      appInfo: { name: 'SnapMarket' },
    });
    return this.client;
  }

  /** Vérifie la signature d'un webhook (plateforme ou Connect). Lève une erreur si invalide. */
  constructEvent(rawBody: Buffer, signature: string, connect: boolean): Stripe.Event {
    const secret = connect
      ? this.config.stripe.connectWebhookSecret
      : this.config.stripe.webhookSecret;
    if (!secret) {
      throw new ServiceUnavailableException('Webhook Stripe non configuré');
    }
    // La vérification de signature ne nécessite pas d'appel réseau.
    return Stripe.webhooks.constructEvent(rawBody, signature, secret, 300);
  }
}
