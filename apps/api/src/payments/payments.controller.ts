import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/auth.decorators';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

/**
 * Webhooks Stripe. La signature est vérifiée sur le corps brut ; tout événement non
 * signé ou trop ancien (tolérance 5 min, protection contre le rejeu) est refusé.
 */
@ApiExcludeController()
@Controller('payments/webhooks')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly payments: PaymentsService,
  ) {}

  @Public()
  @SkipThrottle()
  @Post('stripe')
  @HttpCode(200)
  platform(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    return this.handle(req, signature, false);
  }

  @Public()
  @SkipThrottle()
  @Post('stripe-connect')
  @HttpCode(200)
  connect(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    return this.handle(req, signature, true);
  }

  private async handle(
    req: RawBodyRequest<Request>,
    signature: string | undefined,
    connect: boolean,
  ) {
    if (!signature || !req.rawBody) throw new BadRequestException('Signature manquante');
    let event;
    try {
      event = this.stripe.constructEvent(req.rawBody, signature, connect);
    } catch (e) {
      if ((e as { getStatus?: () => number }).getStatus?.() === 503) throw e;
      this.logger.warn('Webhook Stripe refusé : signature invalide');
      throw new BadRequestException('Signature invalide');
    }
    const { duplicate } = await this.payments.handleEvent(event);
    return { received: true, duplicate };
  }
}
