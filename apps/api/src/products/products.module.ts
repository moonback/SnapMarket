import { Global, Module } from '@nestjs/common';
import { PersonalizationService } from '../feed/personalization.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Global()
@Module({
  controllers: [ProductsController],
  providers: [ProductsService, PersonalizationService],
  exports: [ProductsService, PersonalizationService],
})
export class ProductsModule {}
