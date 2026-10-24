/**
 * Énumérations partagées. Elles doivent rester identiques aux enums Prisma
 * (prisma/schema.prisma). Un test de l'API vérifie cette correspondance.
 */

const values = <T extends string>(...v: T[]) => v;

export const UserRole = {
  USER: 'USER',
  PRO_SELLER: 'PRO_SELLER',
  MODERATOR: 'MODERATOR',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  BANNED: 'BANNED',
  DELETED: 'DELETED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const SellerAccountType = {
  INDIVIDUAL: 'INDIVIDUAL',
  PROFESSIONAL: 'PROFESSIONAL',
} as const;
export type SellerAccountType = (typeof SellerAccountType)[keyof typeof SellerAccountType];

export const SellerVerificationStatus = {
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;
export type SellerVerificationStatus =
  (typeof SellerVerificationStatus)[keyof typeof SellerVerificationStatus];

export const ProductCondition = {
  NEW_WITH_TAGS: 'NEW_WITH_TAGS',
  NEW: 'NEW',
  VERY_GOOD: 'VERY_GOOD',
  GOOD: 'GOOD',
  FAIR: 'FAIR',
} as const;
export type ProductCondition = (typeof ProductCondition)[keyof typeof ProductCondition];
export const PRODUCT_CONDITIONS = values<ProductCondition>(
  'NEW_WITH_TAGS',
  'NEW',
  'VERY_GOOD',
  'GOOD',
  'FAIR',
);
export const PRODUCT_CONDITION_LABELS: Record<ProductCondition, string> = {
  NEW_WITH_TAGS: 'Neuf avec étiquette',
  NEW: 'Neuf sans étiquette',
  VERY_GOOD: 'Très bon état',
  GOOD: 'Bon état',
  FAIR: 'État satisfaisant',
};

export const ProductStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  RESERVED: 'RESERVED',
  SOLD: 'SOLD',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

export const DeliveryMode = { SHIPPING: 'SHIPPING', MEETUP: 'MEETUP' } as const;
export type DeliveryMode = (typeof DeliveryMode)[keyof typeof DeliveryMode];
export const DELIVERY_MODES = values<DeliveryMode>('SHIPPING', 'MEETUP');
export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = {
  SHIPPING: 'Livraison',
  MEETUP: 'Remise en main propre',
};

export const OrderStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  PREPARING: 'PREPARING',
  SHIPPED: 'SHIPPED',
  READY_FOR_HANDOFF: 'READY_FOR_HANDOFF',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  DISPUTED: 'DISPUTED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'En attente de paiement',
  PAID: 'Payée',
  PREPARING: 'En préparation',
  SHIPPED: 'Expédiée',
  READY_FOR_HANDOFF: 'Prête pour la remise',
  COMPLETED: 'Terminée',
  CANCELLED: 'Annulée',
  REFUNDED: 'Remboursée',
  DISPUTED: 'En litige',
};

export const PaymentStatus = {
  REQUIRES_PAYMENT: 'REQUIRES_PAYMENT',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const TransferStatus = {
  NOT_STARTED: 'NOT_STARTED',
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED',
} as const;
export type TransferStatus = (typeof TransferStatus)[keyof typeof TransferStatus];

export const OfferStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  USED: 'USED',
} as const;
export type OfferStatus = (typeof OfferStatus)[keyof typeof OfferStatus];

export const MeetupStatus = {
  PROPOSED: 'PROPOSED',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;
export type MeetupStatus = (typeof MeetupStatus)[keyof typeof MeetupStatus];

export const MediaKind = { IMAGE: 'IMAGE', VIDEO: 'VIDEO' } as const;
export type MediaKind = (typeof MediaKind)[keyof typeof MediaKind];

export const MediaPurpose = {
  PRODUCT: 'PRODUCT',
  STORY: 'STORY',
  MESSAGE: 'MESSAGE',
  AVATAR: 'AVATAR',
} as const;
export type MediaPurpose = (typeof MediaPurpose)[keyof typeof MediaPurpose];

export const MediaStatus = {
  PENDING_UPLOAD: 'PENDING_UPLOAD',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
  DELETED: 'DELETED',
} as const;
export type MediaStatus = (typeof MediaStatus)[keyof typeof MediaStatus];

export const MessageType = { TEXT: 'TEXT', IMAGE: 'IMAGE', SYSTEM: 'SYSTEM' } as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const ReportTargetType = {
  USER: 'USER',
  PRODUCT: 'PRODUCT',
  MESSAGE: 'MESSAGE',
  STORY: 'STORY',
  REVIEW: 'REVIEW',
} as const;
export type ReportTargetType = (typeof ReportTargetType)[keyof typeof ReportTargetType];

export const ReportReason = {
  SPAM: 'SPAM',
  SCAM: 'SCAM',
  PROHIBITED_ITEM: 'PROHIBITED_ITEM',
  COUNTERFEIT: 'COUNTERFEIT',
  INAPPROPRIATE: 'INAPPROPRIATE',
  HARASSMENT: 'HARASSMENT',
  OTHER: 'OTHER',
} as const;
export type ReportReason = (typeof ReportReason)[keyof typeof ReportReason];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  SPAM: 'Spam',
  SCAM: 'Arnaque ou fraude',
  PROHIBITED_ITEM: 'Article interdit',
  COUNTERFEIT: 'Contrefaçon',
  INAPPROPRIATE: 'Contenu inapproprié',
  HARASSMENT: 'Harcèlement',
  OTHER: 'Autre',
};

export const ReportStatus = {
  OPEN: 'OPEN',
  IN_REVIEW: 'IN_REVIEW',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export const ModerationStatus = {
  VISIBLE: 'VISIBLE',
  HIDDEN: 'HIDDEN',
  REMOVED: 'REMOVED',
} as const;
export type ModerationStatus = (typeof ModerationStatus)[keyof typeof ModerationStatus];

export const DisputeStatus = {
  OPEN: 'OPEN',
  RESOLVED_REFUND: 'RESOLVED_REFUND',
  RESOLVED_RELEASE: 'RESOLVED_RELEASE',
} as const;
export type DisputeStatus = (typeof DisputeStatus)[keyof typeof DisputeStatus];

export const NotificationType = {
  NEW_MESSAGE: 'NEW_MESSAGE',
  ORDER_UPDATE: 'ORDER_UPDATE',
  OFFER_UPDATE: 'OFFER_UPDATE',
  MEETUP_UPDATE: 'MEETUP_UPDATE',
  REVIEW_RECEIVED: 'REVIEW_RECEIVED',
  MODERATION: 'MODERATION',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/** Acteurs pouvant déclencher une transition de commande. */
export const OrderActor = {
  BUYER: 'BUYER',
  SELLER: 'SELLER',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
} as const;
export type OrderActor = (typeof OrderActor)[keyof typeof OrderActor];
