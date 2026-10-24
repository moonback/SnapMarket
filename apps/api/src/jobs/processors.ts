import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailService } from '../mail/mail.service';
import { MediaProcessorService } from '../media/media-processor.service';
import { StorageService } from '../media/storage.service';
import { MeetupsService } from '../meetups/meetups.service';
import { PushService } from '../notifications/push.service';
import { OffersService } from '../offers/offers.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  DeleteObjectsJob,
  EmailJob,
  MAINTENANCE_JOBS,
  MediaJob,
  PayoutJob,
  PushJob,
  QUEUE_EMAIL,
  QUEUE_MAINTENANCE,
  QUEUE_MEDIA,
  QUEUE_NOTIFICATIONS,
  QUEUE_PAYOUTS,
} from '../queue/queues';
import { StoriesService } from '../stories/stories.service';

abstract class LoggedWorker extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name);

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.warn(`Tâche ${job?.name} (${job?.id}) en échec : ${error.message}`);
  }
}

@Processor(QUEUE_MEDIA, { concurrency: 2 })
export class MediaWorker extends LoggedWorker {
  constructor(
    private readonly processor: MediaProcessorService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<MediaJob | DeleteObjectsJob>): Promise<void> {
    if (job.name === 'process') return this.processor.process((job.data as MediaJob).mediaId);
    if (job.name === 'delete-objects')
      return this.storage.deleteMany((job.data as DeleteObjectsJob).keys);
  }
}

@Processor(QUEUE_NOTIFICATIONS, { concurrency: 5 })
export class PushWorker extends LoggedWorker {
  constructor(private readonly push: PushService) {
    super();
  }

  process(job: Job<PushJob>): Promise<void> {
    return this.push.send(job.data);
  }
}

@Processor(QUEUE_EMAIL, { concurrency: 2 })
export class EmailWorker extends LoggedWorker {
  constructor(private readonly mail: MailService) {
    super();
  }

  process(job: Job<EmailJob>): Promise<void> {
    return this.mail.send(job.data);
  }
}

@Processor(QUEUE_PAYOUTS, { concurrency: 1 })
export class PayoutWorker extends LoggedWorker {
  constructor(private readonly payments: PaymentsService) {
    super();
  }

  process(job: Job<PayoutJob>): Promise<void> {
    return this.payments.payout(job.data.orderId);
  }
}

@Processor(QUEUE_MAINTENANCE, { concurrency: 1 })
export class MaintenanceWorker extends LoggedWorker {
  constructor(
    private readonly orders: OrdersService,
    private readonly stories: StoriesService,
    private readonly offers: OffersService,
    private readonly meetups: MeetupsService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case MAINTENANCE_JOBS.expireUnpaidOrders:
        return this.orders.expireUnpaid();
      case MAINTENANCE_JOBS.cleanupStories:
        return this.stories.cleanupExpired();
      case MAINTENANCE_JOBS.expireOffers:
        return this.offers.expire();
      case MAINTENANCE_JOBS.meetupReminders:
        return this.meetups.sendReminders();
      case MAINTENANCE_JOBS.cleanupOrphanMedia: {
        // Téléversements jamais finalisés depuis plus de 24 h.
        const stale = await this.prisma.media.findMany({
          where: { status: 'PENDING_UPLOAD', createdAt: { lt: new Date(Date.now() - 86_400_000) } },
          take: 500,
        });
        if (stale.length === 0) return 0;
        await this.storage.deleteMany(stale.map((m) => m.storageKey)).catch(() => undefined);
        await this.prisma.media.updateMany({
          where: { id: { in: stale.map((m) => m.id) } },
          data: { status: 'DELETED', deletedAt: new Date() },
        });
        return stale.length;
      }
      default:
        return null;
    }
  }
}
