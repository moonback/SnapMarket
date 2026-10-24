import { Global, Module } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Global()
@Module({
  controllers: [OrdersController],
  providers: [OrdersService, CheckoutService],
  exports: [OrdersService, CheckoutService],
})
export class OrdersModule {}
