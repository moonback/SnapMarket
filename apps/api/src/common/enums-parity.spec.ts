import * as Prisma from '@prisma/client';
import * as Shared from '@snapmarket/shared';

/** Les énumérations partagées doivent rester identiques aux énumérations Prisma. */
describe('parité des énumérations', () => {
  const names = [
    'UserRole',
    'UserStatus',
    'SellerAccountType',
    'SellerVerificationStatus',
    'ProductCondition',
    'ProductStatus',
    'DeliveryMode',
    'OrderStatus',
    'PaymentStatus',
    'TransferStatus',
    'OfferStatus',
    'MeetupStatus',
    'MediaKind',
    'MediaPurpose',
    'MediaStatus',
    'MessageType',
    'ReportTargetType',
    'ReportReason',
    'ReportStatus',
    'ModerationStatus',
    'DisputeStatus',
    'NotificationType',
  ] as const;

  it.each(names)('%s', (name) => {
    const prismaEnum = (Prisma as unknown as Record<string, Record<string, string>>)[name];
    const sharedEnum = (Shared as unknown as Record<string, Record<string, string>>)[name];
    expect(prismaEnum).toBeDefined();
    expect(Object.values(sharedEnum!).sort()).toEqual(Object.values(prismaEnum!).sort());
  });
});
