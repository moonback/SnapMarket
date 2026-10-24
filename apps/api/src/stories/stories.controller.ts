import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, Public, VerifiedEmail } from '../common/decorators/auth.decorators';
import { CreateStoryDto } from './dto/story.dto';
import { StoriesService } from './stories.service';

@ApiTags('stories')
@ApiBearerAuth()
@Controller('stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Public()
  @Get()
  feed(@CurrentUser() user?: AuthUser) {
    return this.stories.feed(user);
  }

  @Public()
  @Get('user/:userId')
  byUser(@Param('userId') userId: string, @CurrentUser() user?: AuthUser) {
    return this.stories.byUser(userId, user);
  }

  @Post()
  @VerifiedEmail()
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStoryDto) {
    return this.stories.create(user, dto);
  }

  @Post(':id/view')
  @HttpCode(204)
  view(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.stories.markViewed(user, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.stories.remove(user, id);
  }
}
