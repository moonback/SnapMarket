import { Global, Module } from '@nestjs/common';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, RealtimeService],
  exports: [NotificationsService, RealtimeService],
})
export class NotificationsModule {}
