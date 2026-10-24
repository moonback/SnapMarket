import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, VerifiedEmail } from '../common/decorators/auth.decorators';
import {
  CancelOrderDto,
  CreateOrderDto,
  DisputeDto,
  ListOrdersDto,
  ShipOrderDto,
} from './dto/order.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @VerifiedEmail()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListOrdersDto) {
    return this.orders.list(user, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.get(user, id);
  }

  @Get(':id/payment')
  payment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.paymentSession(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.orders.cancel(user, id, dto.reason);
  }

  @Post(':id/preparing')
  @HttpCode(200)
  preparing(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.markPreparing(user, id);
  }

  @Post(':id/ship')
  @HttpCode(200)
  ship(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ShipOrderDto) {
    return this.orders.ship(user, id, dto);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.confirm(user, id);
  }

  @Post(':id/dispute')
  @HttpCode(200)
  dispute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DisputeDto) {
    return this.orders.openDispute(user, id, dto);
  }
}
