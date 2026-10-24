import { Injectable } from '@nestjs/common';
import { Media, Prisma, SellerProfile, User } from '@prisma/client';
import { RatingSummary, SellerProfileDto, SellerSummary } from '@snapmarket/shared';
import { MediaService } from '../media/media.service';

export const USER_SUMMARY_INCLUDE = {
  avatar: true,
  sellerProfile: { select: { accountType: true, verificationStatus: true } },
} satisfies Prisma.UserInclude;

export type UserWithSummary = User & {
  avatar: Media | null;
  sellerProfile: Pick<SellerProfile, 'accountType' | 'verificationStatus'> | null;
};

export function ratingOf(user: Pick<User, 'ratingCount' | 'ratingSum'>): RatingSummary {
  return {
    count: user.ratingCount,
    average:
      user.ratingCount > 0 ? Math.round((user.ratingSum / user.ratingCount) * 10) / 10 : null,
  };
}

/** Un statut professionnel n'est « vérifié » qu'après validation par l'administration. */
export function isProVerified(
  profile: Pick<SellerProfile, 'accountType' | 'verificationStatus'> | null,
): boolean {
  return profile?.accountType === 'PROFESSIONAL' && profile.verificationStatus === 'VERIFIED';
}

export function sellerProfileDto(profile: SellerProfile | null): SellerProfileDto | null {
  if (!profile) return null;
  return {
    accountType: profile.accountType,
    companyName: profile.companyName,
    siret: profile.siret,
    vatNumber: profile.vatNumber,
    verificationStatus: profile.verificationStatus,
    payoutsEnabled: profile.stripePayoutsEnabled,
    stripeOnboardingComplete: profile.stripeDetailsSubmitted,
  };
}

@Injectable()
export class UserPresenter {
  constructor(private readonly media: MediaService) {}

  async avatarUrl(user: { avatar: Media | null }): Promise<string | null> {
    if (!user.avatar || user.avatar.status !== 'READY') return null;
    const dto = await this.media.toDto(user.avatar);
    return dto.thumbnailUrl ?? dto.url;
  }

  async summary(user: UserWithSummary): Promise<SellerSummary> {
    const deleted = user.status === 'DELETED';
    return {
      id: user.id,
      username: deleted ? 'compte-supprime' : user.username,
      displayName: deleted ? 'Compte supprimé' : user.displayName,
      avatarUrl: deleted ? null : await this.avatarUrl(user),
      proVerified: isProVerified(user.sellerProfile),
      rating: ratingOf(user),
    };
  }
}
