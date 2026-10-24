import { Module } from '@nestjs/common';
import { CartController, CheckoutsController } from './cart.controller';
import { CartService } from './cart.service';

@Module({ controllers: [CartController, CheckoutsController], providers: [CartService] })
export class CartModule {}
