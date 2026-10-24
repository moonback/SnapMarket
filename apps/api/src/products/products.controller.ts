import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, Public } from '../common/decorators/auth.decorators';
import {
  CreateProductDto,
  MyProductsDto,
  SearchProductsDto,
  UpdateProductDto,
} from './dto/product.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Public()
  @Get()
  search(@Query() query: SearchProductsDto, @CurrentUser() user?: AuthUser) {
    return this.products.search(query, user);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query() query: MyProductsDto) {
    return this.products.listMine(user, query);
  }

  @Public()
  @Get('sold/:sellerId')
  sold(@Param('sellerId') sellerId: string, @CurrentUser() user?: AuthUser) {
    return this.products.listSold(sellerId, user);
  }

  @Public()
  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.products.detail(id, user);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.products.create(user, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(user, id, dto);
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.publish(user, id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.archive(user, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.remove(user, id);
  }
}
