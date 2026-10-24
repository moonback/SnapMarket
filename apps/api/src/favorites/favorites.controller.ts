import { Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators/auth.decorators';
import { CursorQueryDto } from '../common/dto/pagination.dto';
import { FavoritesService } from './favorites.service';

@ApiTags('favorites')
@ApiBearerAuth()
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: CursorQueryDto) {
    return this.favorites.list(user, query);
  }

  @Put(':productId')
  @HttpCode(204)
  add(@CurrentUser() user: AuthUser, @Param('productId') productId: string) {
    return this.favorites.add(user.id, productId);
  }

  @Delete(':productId')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('productId') productId: string) {
    return this.favorites.remove(user.id, productId);
  }
}
