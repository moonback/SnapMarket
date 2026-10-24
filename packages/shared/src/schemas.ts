/**
 * Schémas Zod utilisés par les formulaires (mobile, admin). L'API applique ses
 * propres validations (class-validator) avec les mêmes bornes : ces schémas
 * améliorent l'expérience utilisateur mais ne remplacent pas le serveur.
 */
import { z } from 'zod';
import {
  BIO_MAX,
  MESSAGE_MAX_LENGTH,
  PASSWORD_MAX,
  PASSWORD_MIN,
  PRICE_MAX_CENTS,
  PRICE_MIN_CENTS,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_MAX_MEDIA,
  PRODUCT_MAX_QUANTITY,
  PRODUCT_TITLE_MAX,
  PRODUCT_TITLE_MIN,
  REVIEW_COMMENT_MAX,
  SHIPPING_FEE_MAX_CENTS,
  USERNAME_REGEX,
} from './constants';
import { DELIVERY_MODES, PRODUCT_CONDITIONS, ReportReason, ReportTargetType } from './enums';

export const emailSchema = z.string().trim().toLowerCase().email('Adresse email invalide').max(254);

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Au moins ${PASSWORD_MIN} caractères`)
  .max(PASSWORD_MAX)
  .regex(/[a-z]/, 'Au moins une minuscule')
  .regex(/[A-Z]/, 'Au moins une majuscule')
  .regex(/[0-9]/, 'Au moins un chiffre');

export const usernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_REGEX, '3 à 24 caractères : lettres, chiffres, « _ » ou « . »');

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'Vous devez accepter les conditions' }),
  }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Mot de passe requis').max(PASSWORD_MAX),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: passwordSchema,
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(50).optional(),
  username: usernameSchema.optional(),
  bio: z.string().trim().max(BIO_MAX).optional(),
  city: z.string().trim().max(80).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const productInputSchema = z
  .object({
    title: z.string().trim().min(PRODUCT_TITLE_MIN).max(PRODUCT_TITLE_MAX),
    description: z.string().trim().max(PRODUCT_DESCRIPTION_MAX),
    priceCents: z.number().int().min(PRICE_MIN_CENTS).max(PRICE_MAX_CENTS),
    categoryId: z.string().min(1, 'Choisissez une catégorie'),
    condition: z.enum(PRODUCT_CONDITIONS as [string, ...string[]]),
    brand: z.string().trim().max(60).optional(),
    quantity: z.number().int().min(1).max(PRODUCT_MAX_QUANTITY).default(1),
    deliveryModes: z.array(z.enum(DELIVERY_MODES as [string, ...string[]])).min(1),
    shippingFeeCents: z.number().int().min(0).max(SHIPPING_FEE_MAX_CENTS).optional(),
    city: z.string().trim().max(80).optional(),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}$/, 'Code postal à 5 chiffres')
      .optional(),
    offersEnabled: z.boolean().default(true),
    mediaIds: z.array(z.string()).max(PRODUCT_MAX_MEDIA),
  })
  .refine((v) => !v.deliveryModes.includes('SHIPPING') || v.shippingFeeCents !== undefined, {
    message: 'Indiquez les frais de livraison',
    path: ['shippingFeeCents'],
  });
export type ProductInput = z.infer<typeof productInputSchema>;

export const addressSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  line1: z.string().trim().min(3).max(120),
  line2: z.string().trim().max(120).optional(),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, 'Code postal à 5 chiffres'),
  city: z.string().trim().min(1).max(80),
  country: z.literal('FR'),
  phone: z
    .string()
    .trim()
    .regex(/^(\+33|0)[1-9](\d{8})$/, 'Numéro de téléphone français invalide')
    .optional(),
});
export type AddressInput = z.infer<typeof addressSchema>;

export const messageSchema = z.object({
  body: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});

export const offerSchema = z.object({
  amountCents: z.number().int().min(PRICE_MIN_CENTS).max(PRICE_MAX_CENTS),
});

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(REVIEW_COMMENT_MAX).optional(),
});

export const reportSchema = z.object({
  targetType: z.nativeEnum(ReportTargetType),
  targetId: z.string().min(1),
  reason: z.nativeEnum(ReportReason),
  details: z.string().trim().max(1000).optional(),
});

export const meetupProposalSchema = z.object({
  scheduledAt: z
    .string()
    .datetime()
    .refine((d) => new Date(d).getTime() > Date.now(), 'La date doit être dans le futur'),
  locationLabel: z.string().trim().min(3).max(200),
  notes: z.string().trim().max(500).optional(),
});
