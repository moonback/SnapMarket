import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { MailService } from '../src/mail/mail.service';
import { StorageService } from '../src/media/storage.service';
import { StripeService } from '../src/payments/stripe.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS } from '../src/redis/redis.module';
import { setupApp } from '../src/setup-app';
import { FakeStorageService, FakeStripeService, MailCapture } from './fakes';

export interface TestContext {
  app: INestApplication;
  http: ReturnType<typeof request>;
  prisma: PrismaService;
  stripe: FakeStripeService;
  storage: FakeStorageService;
  mail: MailCapture;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const mail = new MailCapture();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StripeService)
    .useClass(FakeStripeService)
    .overrideProvider(StorageService)
    .useClass(FakeStorageService)
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true, logger: ['error'] });
  setupApp(app);
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.init();
  const prisma = app.get(PrismaService);
  await truncateAll(prisma);
  await (app.get(REDIS) as Redis).flushdb();
  return {
    app,
    http: request(app.getHttpServer()),
    prisma,
    stripe: app.get(StripeService) as FakeStripeService,
    storage: app.get(StorageService) as FakeStorageService,
    mail,
    close: async () => {
      await app.close();
    },
  };
}

export async function truncateAll(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

let seq = 0;

export interface TestUser {
  id: string;
  email: string;
  username: string;
  token: string;
  auth: { Authorization: string };
}

export async function createUser(
  ctx: TestContext,
  opts: { verified?: boolean; role?: UserRole; payouts?: boolean; password?: string } = {},
): Promise<TestUser> {
  seq++;
  const email = `user${seq}-${Date.now()}@test.invalid`;
  const username = `user_${seq}_${Math.random().toString(36).slice(2, 7)}`;
  const user = await ctx.prisma.user.create({
    data: {
      email,
      username,
      role: opts.role ?? 'USER',
      emailVerifiedAt: opts.verified === false ? null : new Date(),
      passwordHash: opts.password ? await (await import('argon2')).hash(opts.password) : null,
      sellerProfile: opts.payouts
        ? {
            create: {
              stripeAccountId: `acct_test_${seq}`,
              stripePayoutsEnabled: true,
              stripeChargesEnabled: true,
              stripeDetailsSubmitted: true,
            },
          }
        : undefined,
    },
  });
  const tokens = await ctx.app.get(AuthService).issueTokens(user, { ip: null, userAgent: 'jest' });
  return {
    id: user.id,
    email,
    username,
    token: tokens.accessToken,
    auth: { Authorization: `Bearer ${tokens.accessToken}` },
  };
}

export async function createCategory(
  ctx: TestContext,
  data: Partial<Prisma.CategoryCreateInput> = {},
) {
  seq++;
  return ctx.prisma.category.create({
    data: { slug: `cat-${seq}`, name: `Catégorie ${seq}`, ...data },
  });
}

export async function createReadyMedia(
  ctx: TestContext,
  ownerId: string,
  purpose: 'PRODUCT' | 'STORY' | 'MESSAGE' | 'AVATAR' = 'PRODUCT',
) {
  seq++;
  const visibility = purpose === 'MESSAGE' ? 'private' : 'public';
  return ctx.prisma.media.create({
    data: {
      ownerId,
      kind: 'IMAGE',
      purpose,
      status: 'READY',
      storageKey: `${visibility}/${purpose.toLowerCase()}/${ownerId}/m${seq}`,
      thumbnailKey: `${visibility}/${purpose.toLowerCase()}/${ownerId}/m${seq}_thumb`,
      mimeType: 'image/jpeg',
      declaredBytes: 1000,
      width: 800,
      height: 600,
    },
  });
}

export async function createProduct(
  ctx: TestContext,
  sellerId: string,
  data: Partial<Prisma.ProductUncheckedCreateInput> = {},
) {
  const category = data.categoryId ? { id: data.categoryId } : await createCategory(ctx);
  const media = await createReadyMedia(ctx, sellerId);
  return ctx.prisma.product.create({
    data: {
      sellerId,
      categoryId: category.id,
      title: 'Veste en jean',
      description: 'Très bon état',
      priceCents: 2000,
      condition: 'VERY_GOOD',
      deliveryModes: ['SHIPPING', 'MEETUP'],
      shippingFeeCents: 490,
      status: 'ACTIVE',
      publishedAt: new Date(),
      ...data,
      media: { create: [{ mediaId: media.id, position: 0 }] },
    },
  });
}

export const ADDRESS = {
  fullName: 'Camille Martin',
  line1: '10 rue de la Paix',
  postalCode: '75002',
  city: 'Paris',
  country: 'FR',
};
