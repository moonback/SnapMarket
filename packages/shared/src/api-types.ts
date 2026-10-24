/**
 * Contrats de réponse de l'API REST (/api/v1). Les dates sont sérialisées en
 * chaînes ISO 8601. Les montants sont des entiers en centimes d'euro.
 */
import type {
  DeliveryMode,
  DisputeStatus,
  MediaKind,
  MediaStatus,
  MeetupStatus,
  MessageType,
  NotificationType,
  OfferStatus,
  OrderStatus,
  PaymentStatus,
  ProductCondition,
  ProductStatus,
  ReportReason,
  ReportStatus,
  ReportTargetType,
  SellerAccountType,
  SellerVerificationStatus,
  TransferStatus,
  UserRole,
  UserStatus,
} from './enums';

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  code?: string;
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface MediaDto {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  url: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface RatingSummary {
  average: number | null;
  count: number;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  city: string | null;
  createdAt: string;
  accountType: SellerAccountType;
  /** true uniquement si un administrateur a vérifié le statut professionnel. */
  proVerified: boolean;
  rating: RatingSummary;
  activeListingsCount: number;
  soldCount: number;
}

export interface MeUser extends PublicUser {
  email: string;
  emailVerified: boolean;
  role: UserRole;
  status: UserStatus;
  seller: SellerProfileDto | null;
}

export interface SellerProfileDto {
  accountType: SellerAccountType;
  companyName: string | null;
  siret: string | null;
  vatNumber: string | null;
  verificationStatus: SellerVerificationStatus;
  /** Le compte Stripe Connect peut recevoir des transferts. */
  payoutsEnabled: boolean;
  stripeOnboardingComplete: boolean;
}

export interface CategoryDto {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  position: number;
  isActive: boolean;
  requiresReview: boolean;
}

export interface SellerSummary {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  proVerified: boolean;
  rating: RatingSummary;
}

export interface ProductSummary {
  id: string;
  title: string;
  priceCents: number;
  currency: 'EUR';
  condition: ProductCondition;
  status: ProductStatus;
  brand: string | null;
  city: string | null;
  deliveryModes: DeliveryMode[];
  cover: MediaDto | null;
  seller: SellerSummary;
  isFavorite: boolean;
  favoritesCount: number;
  createdAt: string;
}

export interface ProductDetail extends ProductSummary {
  description: string;
  category: CategoryDto;
  quantity: number;
  availableQuantity: number;
  shippingFeeCents: number | null;
  postalCode: string | null;
  offersEnabled: boolean;
  media: MediaDto[];
  updatedAt: string;
  isOwner: boolean;
  /** Possibilité d'achat évaluée par le serveur (le serveur revérifie à la commande). */
  purchase: { available: boolean; reason: string | null };
  moderationStatus: 'VISIBLE' | 'HIDDEN' | 'REMOVED';
}

export interface StoryDto {
  id: string;
  author: SellerSummary;
  media: MediaDto;
  caption: string | null;
  product: Pick<ProductSummary, 'id' | 'title' | 'priceCents'> | null;
  expiresAt: string;
  createdAt: string;
  viewed: boolean;
  viewsCount: number | null;
}

export interface StoryGroupDto {
  author: SellerSummary;
  stories: StoryDto[];
  hasUnviewed: boolean;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string | null;
  type: MessageType;
  body: string | null;
  media: MediaDto | null;
  clientMessageId: string | null;
  createdAt: string;
  readByOther: boolean;
}

export interface ConversationDto {
  id: string;
  otherUser: SellerSummary;
  product: Pick<ProductSummary, 'id' | 'title' | 'priceCents' | 'cover' | 'status'> | null;
  lastMessage: MessageDto | null;
  unreadCount: number;
  blocked: boolean;
  updatedAt: string;
}

export interface OfferDto {
  id: string;
  productId: string;
  buyerId: string;
  sellerId: string;
  amountCents: number;
  status: OfferStatus;
  expiresAt: string | null;
  createdAt: string;
}

export interface AddressDto {
  fullName: string;
  line1: string;
  line2: string | null;
  postalCode: string;
  city: string;
  country: 'FR';
  phone: string | null;
}

export interface OrderPricing {
  itemPriceCents: number;
  shippingFeeCents: number;
  /** Total payé par l'acheteur. */
  totalCents: number;
  /** Commission plateforme calculée (prélevée uniquement à la libération des fonds). */
  commissionCents: number;
  commissionBps: number;
  /** Montant transféré au vendeur à la fin de la transaction. */
  sellerPayoutCents: number;
}

export interface ShipmentDto {
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  events: { status: string; note: string | null; createdAt: string }[];
}

export interface MeetupDto {
  id: string;
  proposedById: string;
  scheduledAt: string;
  locationLabel: string;
  notes: string | null;
  status: MeetupStatus;
  createdAt: string;
}

export interface OrderStatusEventDto {
  from: OrderStatus | null;
  to: OrderStatus;
  actor: string;
  note: string | null;
  createdAt: string;
}

export interface OrderDto {
  id: string;
  reference: string;
  status: OrderStatus;
  deliveryMode: DeliveryMode;
  role: 'BUYER' | 'SELLER' | 'ADMIN';
  product: Pick<ProductSummary, 'id' | 'title' | 'cover'>;
  buyer: SellerSummary;
  seller: SellerSummary;
  quantity: number;
  pricing: OrderPricing;
  paymentStatus: PaymentStatus | null;
  transferStatus: TransferStatus;
  shippingAddress: AddressDto | null;
  shipment: ShipmentDto | null;
  meetups: MeetupDto[];
  history: OrderStatusEventDto[];
  allowedTransitions: OrderStatus[];
  canReview: boolean;
  dispute: { id: string; status: DisputeStatus; reason: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutSession {
  order: OrderDto;
  /** client_secret Stripe du PaymentIntent à confirmer avec le SDK Stripe. */
  paymentClientSecret: string;
  publishableKeyRequired: true;
}

export interface ReviewDto {
  id: string;
  orderId: string;
  author: SellerSummary;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string> | null;
  readAt: string | null;
  createdAt: string;
}

export interface ReportDto {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  reporter: SellerSummary;
  resolutionNote: string | null;
  createdAt: string;
}

export interface UploadTicket {
  mediaId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface PlatformStatus {
  paymentsAvailable: boolean;
  shippingCarrierConfigured: boolean;
  pushConfigured: boolean;
  mediaStorageConfigured: boolean;
}
