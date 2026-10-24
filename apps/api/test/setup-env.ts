// Environnement des tests automatisés : base dédiée, aucun service externe réel.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://snapmarket:snapmarket@localhost:5432/snapmarket_test?schema=public';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
process.env.JWT_ACCESS_SECRET = 'test-only-secret-not-used-anywhere-else-0123456789';
process.env.SMTP_HOST = '';
// Clés FACTICES pour les tests : le client Stripe est remplacé par un double de test,
// seule la vérification de signature des webhooks (locale) utilise ce secret.
process.env.STRIPE_SECRET_KEY = 'sk_test_FAKE_KEY_FOR_AUTOMATED_TESTS';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_FAKE_SECRET_FOR_AUTOMATED_TESTS';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_FAKE_CONNECT_SECRET_FOR_TESTS';
process.env.S3_BUCKET = 'test-bucket';
process.env.S3_ACCESS_KEY_ID = 'test';
process.env.S3_SECRET_ACCESS_KEY = 'test';
process.env.MEDIA_CDN_URL = 'https://cdn.test.invalid';
process.env.PLATFORM_COMMISSION_BPS = '500';
