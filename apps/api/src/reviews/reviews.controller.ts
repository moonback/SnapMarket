import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public } from '../common/decorators/auth.decorators';
import { CursorQueryDto } from '../common/dto/pagination.dto';
import { CreateReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('reviews')
@ApiBearerAuth()
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('orders/:orderId/reviews')
  create(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(user.id, orderId, dto);
  }

  @Public()
  @Get('users/:userId/reviews')
  list(@Param('userId') userId: string, @Query() query: CursorQueryDto) {
    return this.reviews.forUser(userId, query);
  }
}
