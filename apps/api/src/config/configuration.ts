/**
 * Configuration typée, validée au démarrage. Toute variable obligatoire manquante
 * fait échouer le démarrage plutôt que de fonctionner avec une valeur inventée.
 */
export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  apiPublicUrl: string;
  appPublicUrl: string;
  corsOrigins: string[];
  databaseUrl: string;
  redisUrl: string;
  jwt: { accessSecret: string; accessTtlSeconds: number; refreshTtlDays: number };
  login: { maxFailedAttempts: number; lockMinutes: number };
  smtp: {
    host: string | null;
    port: number;
    secure: boolean;
    user: string | null;
    password: string | null;
    from: string;
  };
  s3: {
    endpoint: string | null;
    region: string;
    bucket: string | null;
    accessKeyId: string | null;
    secretAccessKey: string | null;
    forcePathStyle: boolean;
    cdnUrl: string | null;
    uploadTtlSeconds: number;
    downloadTtlSeconds: number;
  };
  stripe: {
    secretKey: string | null;
    webhookSecret: string | null;
    connectWebhookSecret: string | null;
    connectReturnUrl: string;
    connectRefreshUrl: string;
  };
  business: { defaultCommissionBps: number; defaultStoryTtlHours: number };
  expoAccessToken: string | null;
}

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return v;
}

function optional(name: string): string | null {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? null : v.trim();
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${name} doit être un entier`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export function loadConfig(): AppConfig {
  const env = (process.env.NODE_ENV ?? 'development') as AppConfig['env'];
  const accessSecret = str('JWT_ACCESS_SECRET');
  if (accessSecret.length < 32 || (env === 'production' && accessSecret.startsWith('change-me'))) {
    throw new Error('JWT_ACCESS_SECRET doit être un secret aléatoire d’au moins 32 caractères');
  }
  const commission = int('PLATFORM_COMMISSION_BPS', 500);
  if (commission < 0 || commission > 5000) {
    throw new Error('PLATFORM_COMMISSION_BPS doit être compris entre 0 et 5000');
  }
  return {
    env,
    port: int('PORT', 3000),
    apiPublicUrl: str('API_PUBLIC_URL', 'http://localhost:3000'),
    appPublicUrl: str('APP_PUBLIC_URL', 'snapmarket://'),
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    databaseUrl: str('DATABASE_URL'),
    redisUrl: str('REDIS_URL', 'redis://localhost:6379'),
    jwt: {
      accessSecret,
      accessTtlSeconds: int('JWT_ACCESS_TTL_SECONDS', 900),
      refreshTtlDays: int('REFRESH_TOKEN_TTL_DAYS', 30),
    },
    login: {
      maxFailedAttempts: int('LOGIN_MAX_FAILED_ATTEMPTS', 5),
      lockMinutes: int('LOGIN_LOCK_MINUTES', 15),
    },
    smtp: {
      host: optional('SMTP_HOST'),
      port: int('SMTP_PORT', 587),
      secure: bool('SMTP_SECURE', false),
      user: optional('SMTP_USER'),
      password: optional('SMTP_PASSWORD'),
      from: str('MAIL_FROM', 'SnapMarket <no-reply@snapmarket.local>'),
    },
    s3: {
      endpoint: optional('S3_ENDPOINT'),
      region: str('S3_REGION', 'eu-west-3'),
      bucket: optional('S3_BUCKET'),
      accessKeyId: optional('S3_ACCESS_KEY_ID'),
      secretAccessKey: optional('S3_SECRET_ACCESS_KEY'),
      forcePathStyle: bool('S3_FORCE_PATH_STYLE', false),
      cdnUrl: optional('MEDIA_CDN_URL'),
      uploadTtlSeconds: int('MEDIA_UPLOAD_URL_TTL_SECONDS', 300),
      downloadTtlSeconds: int('MEDIA_DOWNLOAD_URL_TTL_SECONDS', 3600),
    },
    stripe: {
      secretKey: optional('STRIPE_SECRET_KEY'),
      webhookSecret: optional('STRIPE_WEBHOOK_SECRET'),
      connectWebhookSecret: optional('STRIPE_CONNECT_WEBHOOK_SECRET'),
      connectReturnUrl: str('STRIPE_CONNECT_RETURN_URL', 'snapmarket://seller/stripe-return'),
      connectRefreshUrl: str('STRIPE_CONNECT_REFRESH_URL', 'snapmarket://seller/stripe-refresh'),
    },
    business: {
      defaultCommissionBps: commission,
      defaultStoryTtlHours: int('STORY_TTL_HOURS', 24),
    },
    expoAccessToken: optional('EXPO_ACCESS_TOKEN'),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
