export const QUEUE_MEDIA = 'media';
export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_EMAIL = 'email';
export const QUEUE_PAYOUTS = 'payouts';
export const QUEUE_MAINTENANCE = 'maintenance';

export const ALL_QUEUES = [
  QUEUE_MEDIA,
  QUEUE_NOTIFICATIONS,
  QUEUE_EMAIL,
  QUEUE_PAYOUTS,
  QUEUE_MAINTENANCE,
] as const;

export interface MediaJob {
  mediaId: string;
}
export interface DeleteObjectsJob {
  keys: string[];
}
export interface PushJob {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}
export interface EmailJob {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
export interface PayoutJob {
  orderId: string;
}

export const MAINTENANCE_JOBS = {
  expireUnpaidOrders: 'expire-unpaid-orders',
  cleanupStories: 'cleanup-expired-stories',
  expireOffers: 'expire-offers',
  meetupReminders: 'meetup-reminders',
  cleanupOrphanMedia: 'cleanup-orphan-media',
} as const;
