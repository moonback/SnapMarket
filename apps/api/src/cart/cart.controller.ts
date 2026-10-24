import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, VerifiedEmail } from '../common/decorators/auth.decorators';
import { CheckoutService } from '../orders/checkout.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { CartService } from './cart.service';
import { CartCheckoutDto, UpsertCartItemDto } from './dto/cart.dto';

@ApiTags('cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.cart.get(user);
  }

  @Put('items/:productId')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() dto: UpsertCartItemDto,
  ) {
    return this.cart.upsert(user, productId, dto);
  }

  @Delete('items/:productId')
  remove(@CurrentUser() user: AuthUser, @Param('productId') productId: string) {
    return this.cart.remove(user, productId);
  }

  @Delete()
  @HttpCode(204)
  clear(@CurrentUser() user: AuthUser) {
    return this.cart.clear(user);
  }

  @Post('checkout')
  @VerifiedEmail()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CartCheckoutDto) {
    return this.cart.checkout(user, dto);
  }
}

/** Paiements groupés (un paiement couvrant une ou plusieurs commandes). */
@ApiTags('cart')
@ApiBearerAuth()
@Controller('checkouts')
export class CheckoutsController {
  constructor(
    private readonly orders: OrdersService,
    private readonly checkouts: CheckoutService,
    private readonly payments: PaymentsService,
  ) {}

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.checkoutDto(user, id);
  }

  /** Reprise du paiement (client_secret) tant que des commandes attendent le paiement. */
  @Get(':id/payment')
  async payment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const checkout = await this.orders.checkoutDto(user, id);
    if (checkout.orders[0]?.buyer.id !== user.id) throw new ForbiddenException('Accès refusé');
    if (!checkout.orders.some((o) => o.status === 'PENDING_PAYMENT')) {
      throw new ConflictException('Ce paiement n’est plus en attente');
    }
    return { checkout, paymentClientSecret: await this.payments.clientSecret(id) };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const checkout = await this.orders.checkoutDto(user, id);
    if (checkout.orders[0]?.buyer.id !== user.id) throw new ForbiddenException('Accès refusé');
    const cancelled = await this.checkouts.cancelPending(
      id,
      'BUYER',
      user.id,
      'Annulé par l’acheteur',
    );
    if (cancelled === 0) throw new ConflictException('Ce paiement n’est plus annulable');
    return this.orders.checkoutDto(user, id);
  }
}
