import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, VerifiedEmail } from '../common/decorators/auth.decorators';
import { CursorQueryDto } from '../common/dto/pagination.dto';
import { ConversationsService } from './conversations.service';
import { OpenConversationDto, SendMessageDto } from './dto/conversation.dto';

@ApiTags('conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: CursorQueryDto) {
    return this.conversations.list(user.id, query);
  }

  @Get('unread-count')
  async unread(@CurrentUser() user: AuthUser) {
    return { count: await this.conversations.unreadCount(user.id) };
  }

  @Post()
  @VerifiedEmail()
  open(@CurrentUser() user: AuthUser, @Body() dto: OpenConversationDto) {
    return this.conversations.open(user.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.get(user.id, id);
  }

  @Get(':id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() query: CursorQueryDto) {
    return this.conversations.messages(user.id, id, query);
  }

  @Post(':id/messages')
  @VerifiedEmail()
  send(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.conversations.send(user.id, id, dto);
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.markRead(user.id, id);
  }
}
