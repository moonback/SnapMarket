import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import {
  EmailWorker,
  MaintenanceWorker,
  MediaWorker,
  PayoutWorker,
  PushWorker,
} from './jobs/processors';
import { SchedulerService } from './jobs/scheduler.service';
import { MediaProcessorService } from './media/media-processor.service';
import { PushService } from './notifications/push.service';

@Module({
  imports: [CoreModule],
  providers: [
    MediaProcessorService,
    PushService,
    MediaWorker,
    PushWorker,
    EmailWorker,
    PayoutWorker,
    MaintenanceWorker,
    SchedulerService,
  ],
})
export class WorkerModule {}
