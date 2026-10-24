import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { AppConfigModule } from './config/config.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MailModule } from './mail/mail.module';
import { MediaModule } from './media/media.module';
import { MeetupsModule } from './meetups/meetups.module';
import { ModerationModule } from './moderation/moderation.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OffersModule } from './offers/offers.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './redis/redis.module';
import { SettingsModule } from './settings/settings.module';
import { StoriesModule } from './stories/stories.module';
import { UsersModule } from './users/users.module';

/** Modules partagés par l'API HTTP et le worker. */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    AuditModule,
    MailModule,
    SettingsModule,
    MediaModule,
    ModerationModule,
    NotificationsModule,
    UsersModule,
    AuthModule,
    CategoriesModule,
    PaymentsModule,
    ConversationsModule,
    ProductsModule,
    StoriesModule,
    OrdersModule,
    OffersModule,
    MeetupsModule,
  ],
})
export class CoreModule {}
