import { Global, Module } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ChatGateway } from './chat.gateway';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Global()
@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService, ChatGateway, JwtAuthGuard],
  exports: [ConversationsService],
})
export class ConversationsModule {}
