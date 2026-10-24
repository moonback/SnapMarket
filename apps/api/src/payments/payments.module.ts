import { Global, Module } from '@nestjs/common';
import { OrderStateService } from '../orders/order-state.service';
import { PaymentsWebhookController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

@Global()
@Module({
  controllers: [PaymentsWebhookController],
  providers: [StripeService, PaymentsService, OrderStateService],
  exports: [StripeService, PaymentsService, OrderStateService],
})
export class PaymentsModule {}
