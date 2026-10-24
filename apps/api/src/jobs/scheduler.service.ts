import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { MAINTENANCE_JOBS, QUEUE_MAINTENANCE } from '../queue/queues';

/** Planification des tâches récurrentes (une seule fois quel que soit le nombre de workers). */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE_MAINTENANCE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    const every = (minutes: number) => ({ every: minutes * 60_000 });
    await this.queue.upsertJobScheduler(MAINTENANCE_JOBS.expireUnpaidOrders, every(1), {
      name: MAINTENANCE_JOBS.expireUnpaidOrders,
    });
    await this.queue.upsertJobScheduler(MAINTENANCE_JOBS.cleanupStories, every(15), {
      name: MAINTENANCE_JOBS.cleanupStories,
    });
    await this.queue.upsertJobScheduler(MAINTENANCE_JOBS.expireOffers, every(10), {
      name: MAINTENANCE_JOBS.expireOffers,
    });
    await this.queue.upsertJobScheduler(MAINTENANCE_JOBS.meetupReminders, every(5), {
      name: MAINTENANCE_JOBS.meetupReminders,
    });
    await this.queue.upsertJobScheduler(MAINTENANCE_JOBS.cleanupOrphanMedia, every(60), {
      name: MAINTENANCE_JOBS.cleanupOrphanMedia,
    });
  }
}
