import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { AdminModule } from './admin/admin.module';
import { CartModule } from './cart/cart.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { APP_CONFIG, AppConfig } from './config/configuration';
import { CoreModule } from './core.module';
import { FavoritesModule } from './favorites/favorites.module';
import { FeedModule } from './feed/feed.module';
import { HealthModule } from './health/health.module';
import { REDIS } from './redis/redis.module';
import { ReportsModule } from './reports/reports.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SellersModule } from './sellers/sellers.module';

@Module({
  imports: [
    CoreModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG, REDIS],
      useFactory: (config: AppConfig, redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        storage: new ThrottlerStorageRedisService(redis),
        // Désactivé uniquement pour la suite de tests automatisés.
        skipIf: () => config.env === 'test',
      }),
    }),
    HealthModule,
    FeedModule,
    FavoritesModule,
    ReviewsModule,
    ReportsModule,
    SellersModule,
    CartModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
