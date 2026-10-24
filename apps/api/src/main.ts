import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';

/** Adaptateur Socket.IO avec Redis pour diffuser les événements entre instances. */
class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  connect(url: string): void {
    const pub = new Redis(url);
    const sub = pub.duplicate();
    this.adapterConstructor = createAdapter(pub, sub);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}

async function bootstrap(): Promise<void> {
  // rawBody est nécessaire à la vérification de signature des webhooks Stripe.
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: false });
  const config = setupApp(app);

  const adapter = new RedisIoAdapter(app);
  adapter.connect(config.redisUrl);
  app.useWebSocketAdapter(adapter);

  if (config.env !== 'production' || process.env.ENABLE_SWAGGER === 'true') {
    const doc = new DocumentBuilder()
      .setTitle('SnapMarket API')
      .setDescription('API REST v1 de SnapMarket. Montants en centimes d’euro.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  }

  await app.listen(config.port);
  new Logger('Bootstrap').log(`API SnapMarket démarrée sur le port ${config.port}`);
}

void bootstrap();
