import { Inject, Injectable, Logger } from '@nestjs/common';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { PushJob } from '../queue/queues';

/** Envoi des notifications push via le service Expo (exécuté par le worker). */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly expo: Expo;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.expo = new Expo({ accessToken: config.expoAccessToken ?? undefined });
  }

  async send(job: PushJob): Promise<void> {
    const tokens = await this.prisma.pushToken.findMany({ where: { userId: job.userId } });
    const valid = tokens.filter((t) => Expo.isExpoPushToken(t.token));
    if (valid.length === 0) return;
    const messages: ExpoPushMessage[] = valid.map((t) => ({
      to: t.token,
      title: job.title,
      body: job.body,
      data: job.data,
      sound: 'default',
    }));
    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      const tickets = await this.expo.sendPushNotificationsAsync(chunk);
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i]!;
        if (ticket.status === 'error') {
          const to = chunk[i]!.to as string;
          if (ticket.details?.error === 'DeviceNotRegistered') {
            await this.prisma.pushToken.deleteMany({ where: { token: to } });
          } else {
            this.logger.warn(`Échec push : ${ticket.message}`);
          }
        }
      }
    }
  }
}
