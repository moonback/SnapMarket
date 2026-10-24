import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { NotificationDto, Paginated } from '@snapmarket/shared';
import { CursorQueryDto } from '../common/dto/pagination.dto';
import { decodeCursor, pageSize, paginate } from '../common/utils/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { PushJob, QUEUE_NOTIFICATIONS } from '../queue/queues';
import { RealtimeService } from '../realtime/realtime.service';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Envoyer aussi une notification push (par défaut : oui). */
  push?: boolean;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly queue: Queue<PushJob>,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    const n = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? Prisma.JsonNull,
      },
    });
    this.realtime.toUser(input.userId, 'notification', toDto(n));
    if (input.push !== false) {
      await this.queue.add('push', {
        userId: input.userId,
        title: input.title,
        body: input.body,
        data: { ...(input.data ?? {}), notificationId: n.id, type: input.type },
      });
    }
  }

  async list(
    userId: string,
    query: CursorQueryDto,
  ): Promise<Paginated<NotificationDto> & { unread: number }> {
    const limit = pageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.notification.findMany({
      where: {
        userId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(String(cursor.v)) } },
                { createdAt: new Date(String(cursor.v)), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = paginate(rows, limit, (n) => ({ v: n.createdAt.toISOString(), id: n.id }));
    const unread = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { items: page.items.map(toDto), nextCursor: page.nextCursor, unread };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const res = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (res.count === 0) {
      const exists = await this.prisma.notification.count({ where: { id, userId } });
      if (!exists) throw new NotFoundException('Notification introuvable');
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}

function toDto(n: {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDto {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: (n.data as Record<string, string> | null) ?? null,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}
