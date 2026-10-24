export const API_PREFIX = '/api/v1';
export const CURRENCY = 'EUR' as const;

/** Bornes de prix d'une annonce, en centimes d'euro. */
export const PRICE_MIN_CENTS = 100; // 1,00 €
export const PRICE_MAX_CENTS = 10_000_000; // 100 000,00 €
export const SHIPPING_FEE_MAX_CENTS = 20_000; // 200,00 €

export const PRODUCT_TITLE_MIN = 3;
export const PRODUCT_TITLE_MAX = 80;
export const PRODUCT_DESCRIPTION_MAX = 4000;
export const PRODUCT_MAX_MEDIA = 10;
export const PRODUCT_MAX_QUANTITY = 999;

export const MESSAGE_MAX_LENGTH = 2000;
export const REVIEW_COMMENT_MAX = 1000;
export const BIO_MAX = 300;
export const USERNAME_REGEX = /^[a-zA-Z0-9_.]{3,24}$/;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export const STORY_DEFAULT_TTL_HOURS = 24;
export const STORY_MAX_TTL_HOURS = 72;

/** Limites de téléversement vérifiées par l'API (taille déclarée + taille réelle). */
export const MEDIA_LIMITS = {
  IMAGE: {
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
  },
  VIDEO: {
    maxBytes: 50 * 1024 * 1024,
    maxDurationSeconds: 60,
    mimeTypes: ['video/mp4', 'video/quicktime'] as const,
  },
} as const;

export const ALLOWED_MIME_TYPES = [
  ...MEDIA_LIMITS.IMAGE.mimeTypes,
  ...MEDIA_LIMITS.VIDEO.mimeTypes,
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Délai de validité d'une offre acceptée pour passer commande. */
export const OFFER_ACCEPTED_VALIDITY_HOURS = 48;
/** Délai avant annulation automatique d'une commande non payée. */
export const PENDING_PAYMENT_EXPIRY_MINUTES = 30;

/** Nombre maximal d'annonces différentes dans un panier / un paiement groupé. */
export const CART_MAX_ITEMS = 20;
