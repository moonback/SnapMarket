import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { API_PREFIX } from '@snapmarket/shared';
import { APP_CONFIG, AppConfig } from './config/configuration';

/** Configuration commune de l'application (utilisée par main.ts et les tests e2e). */
export function setupApp(app: INestApplication): AppConfig {
  const config = app.get<AppConfig>(APP_CONFIG);
  const express = app as NestExpressApplication;
  if (process.env.TRUST_PROXY)
    express.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  express.disable('x-powered-by');
  app.use(helmet());
  app.enableCors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
  });
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ''));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();
  return config;
}
