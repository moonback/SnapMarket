/**
 * Doubles de test des intégrations externes. Ils ne sont utilisés QUE dans les tests
 * automatisés ; l'application réelle n'a aucun mode simulé.
 */
import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { EmailJob } from '../src/queue/queues';
import { StripeService } from '../src/payments/stripe.service';
import { StorageService } from '../src/media/storage.service';

export class FakeStripeClient {
  calls: { method: string; args: unknown[] }[] = [];
  private seq = 0;
  failNextPaymentIntent = false;

  private id(prefix: string) {
    return `${prefix}_test_${++this.seq}`;
  }

  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
  }

  callsOf(method: string) {
    return this.calls.filter((c) => c.method === method);
  }

  paymentIntents = {
    create: async (params: Stripe.PaymentIntentCreateParams, opts?: Stripe.RequestOptions) => {
      this.record('paymentIntents.create', [params, opts]);
      if (this.failNextPaymentIntent) {
        this.failNextPaymentIntent = false;
        throw new Error('Stripe indisponible (double de test)');
      }
      const id = this.id('pi');
      return {
        id,
        client_secret: `${id}_secret_test`,
        amount: params.amount,
        status: 'requires_payment_method',
      };
    },
    retrieve: async (id: string) => {
      this.record('paymentIntents.retrieve', [id]);
      return { id, client_secret: `${id}_secret_test` };
    },
    cancel: async (id: string) => {
      this.record('paymentIntents.cancel', [id]);
      return { id, status: 'canceled' };
    },
  };

  refunds = {
    create: async (params: Stripe.RefundCreateParams, opts?: Stripe.RequestOptions) => {
      this.record('refunds.create', [params, opts]);
      return { id: this.id('re'), amount: 0, status: 'succeeded' };
    },
  };

  transfers = {
    create: async (params: Stripe.TransferCreateParams, opts?: Stripe.RequestOptions) => {
      this.record('transfers.create', [params, opts]);
      return { id: this.id('tr'), amount: params.amount };
    },
    createReversal: async (
      id: string,
      params: Stripe.TransferCreateReversalParams,
      opts?: Stripe.RequestOptions,
    ) => {
      this.record('transfers.createReversal', [id, params, opts]);
      return { id: this.id('trr'), amount: params.amount };
    },
  };

  accounts = {
    create: async (params: Stripe.AccountCreateParams) => {
      this.record('accounts.create', [params]);
      return { id: this.id('acct') };
    },
    retrieve: async (id: string) => ({
      id,
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      capabilities: { transfers: 'active' },
    }),
  };

  accountLinks = {
    create: async (params: Stripe.AccountLinkCreateParams) => {
      this.record('accountLinks.create', [params]);
      return {
        url: 'https://connect.stripe.test.invalid/onboarding',
        expires_at: Math.floor(Date.now() / 1000) + 300,
      };
    },
  };
}

@Injectable()
export class FakeStripeService extends StripeService {
  readonly fake = new FakeStripeClient();
  enabled = true;

  override get configured(): boolean {
    return this.enabled;
  }

  override get stripe(): Stripe {
    if (!this.enabled) return super.stripe;
    return this.fake as unknown as Stripe;
  }
}

/** En-tête de signature Stripe valide pour un corps donné (la vérification reste réelle). */
export function signStripePayload(
  payload: string,
  secret = process.env.STRIPE_WEBHOOK_SECRET!,
): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

@Injectable()
export class FakeStorageService extends StorageService {
  objects = new Map<string, { size: number; type: string }>();

  override get configured(): boolean {
    return true;
  }
  override async createUploadUrl(key: string): Promise<string> {
    return `https://storage.test.invalid/${key}?signature=test`;
  }
  override async head(key: string) {
    const o = this.objects.get(key);
    return o ? { contentLength: o.size, contentType: o.type } : null;
  }
  override async deleteMany(keys: string[]): Promise<void> {
    keys.forEach((k) => this.objects.delete(k));
  }
  override async signedGetUrl(key: string): Promise<string> {
    return `https://storage.test.invalid/${key}?signed=1`;
  }
  /** Simule le téléversement direct du client vers le stockage. */
  upload(key: string, size: number, type: string): void {
    this.objects.set(key, { size, type });
  }
}

export class MailCapture {
  sent: EmailJob[] = [];
  configured = true;
  enqueue = async (job: EmailJob) => {
    this.sent.push(job);
  };
  send = async () => undefined;
  verificationEmail = (to: string, link: string): EmailJob => ({
    to,
    subject: 'verify',
    text: link,
  });
  resetPasswordEmail = (to: string, link: string): EmailJob => ({
    to,
    subject: 'reset',
    text: link,
  });
  lastToken(): string {
    const last = this.sent[this.sent.length - 1];
    const m = /token=([^&\s]+)/.exec(last?.text ?? '');
    if (!m) throw new Error('Aucun jeton dans le dernier email');
    return decodeURIComponent(m[1]!);
  }
}
