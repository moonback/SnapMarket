import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import Redis from 'ioredis';
import { PlatformStatus } from '@snapmarket/shared';
import { Public } from '../common/decorators/auth.decorators';
import { MailService } from '../mail/mail.service';
import { StorageService } from '../media/storage.service';
import { StripeService } from '../payments/stripe.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

@ApiTags('health')
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly stripe: StripeService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
  ) {}

  @Public()
  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.redis.ping();
    } catch {
      throw new ServiceUnavailableException({ status: 'error' });
    }
    return { status: 'ok' };
  }

  /** État des intégrations, utilisé par les clients pour désactiver honnêtement les fonctions. */
  @Public()
  @Get('status')
  status(): PlatformStatus & { emailConfigured: boolean } {
    return {
      paymentsAvailable: this.stripe.configured,
      shippingCarrierConfigured: false,
      pushConfigured: true,
      mediaStorageConfigured: this.storage.configured,
      emailConfigured: this.mail.configured,
    };
  }
}
