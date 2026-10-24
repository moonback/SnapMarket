import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SellerProfileDto } from '@snapmarket/shared';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { StripeService } from '../payments/stripe.service';
import { PrismaService } from '../prisma/prisma.service';
import { sellerProfileDto } from '../users/user-presenter.service';
import { ProRequestDto } from './dto/seller.dto';

/** Contrôle de Luhn du SIRET (exception documentée pour La Poste : SIREN 356000000). */
export function isValidSiret(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  if (siret.startsWith('356000000')) {
    return siret.split('').reduce((s, d) => s + Number(d), 0) % 5 === 0;
  }
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(siret[13 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

@Injectable()
export class SellersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async me(userId: string): Promise<SellerProfileDto | null> {
    return sellerProfileDto(await this.prisma.sellerProfile.findUnique({ where: { userId } }));
  }

  /**
   * Demande de statut professionnel. Le contrôle de format ne vaut pas vérification :
   * le statut reste « en attente » jusqu'à la validation manuelle par l'administration.
   */
  async requestPro(userId: string, dto: ProRequestDto): Promise<SellerProfileDto> {
    if (!isValidSiret(dto.siret)) throw new BadRequestException('SIRET invalide');
    const existing = await this.prisma.sellerProfile.findUnique({ where: { userId } });
    if (existing?.verificationStatus === 'VERIFIED')
      throw new ConflictException('Statut professionnel déjà vérifié');
    const data = {
      accountType: 'PROFESSIONAL' as const,
      companyName: dto.companyName.trim(),
      siret: dto.siret,
      vatNumber: dto.vatNumber ?? null,
      legalAddress: dto.legalAddress as unknown as Prisma.InputJsonValue,
      verificationStatus: 'PENDING' as const,
      verificationNote: null,
    };
    const profile = await this.prisma.sellerProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    await this.audit.log({
      actorId: userId,
      action: 'seller.pro_request',
      entityType: 'SellerProfile',
      entityId: profile.id,
    });
    return sellerProfileDto(profile)!;
  }

  /** Crée (si besoin) le compte Stripe Express du vendeur et renvoie un lien d'onboarding. */
  async onboardingLink(userId: string): Promise<{ url: string; expiresAt: string }> {
    const stripe = this.stripe.stripe;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { sellerProfile: true },
    });
    let profile = user.sellerProfile;
    if (!profile?.stripeAccountId) {
      const professional = profile?.accountType === 'PROFESSIONAL';
      const account = await stripe.accounts.create(
        {
          type: 'express',
          country: 'FR',
          email: user.email,
          business_type: professional ? 'company' : 'individual',
          capabilities: { transfers: { requested: true } },
          metadata: { userId },
        },
        { idempotencyKey: `seller-account-${userId}` },
      );
      profile = await this.prisma.sellerProfile.upsert({
        where: { userId },
        create: { userId, stripeAccountId: account.id },
        update: { stripeAccountId: account.id },
      });
      await this.audit.log({
        actorId: userId,
        action: 'seller.stripe_account_created',
        entityType: 'SellerProfile',
        entityId: profile.id,
      });
    }
    const link = await stripe.accountLinks.create({
      account: profile.stripeAccountId!,
      type: 'account_onboarding',
      return_url: this.config.stripe.connectReturnUrl,
      refresh_url: this.config.stripe.connectRefreshUrl,
    });
    return { url: link.url, expiresAt: new Date(link.expires_at * 1000).toISOString() };
  }

  /** Resynchronise l'état du compte Stripe (complément du webhook account.updated). */
  async refreshStripeStatus(userId: string): Promise<SellerProfileDto | null> {
    const profile = await this.prisma.sellerProfile.findUnique({ where: { userId } });
    if (!profile?.stripeAccountId) return sellerProfileDto(profile);
    const account = await this.stripe.stripe.accounts.retrieve(profile.stripeAccountId);
    const updated = await this.prisma.sellerProfile.update({
      where: { userId },
      data: {
        stripeChargesEnabled: account.charges_enabled ?? false,
        stripePayoutsEnabled:
          (account.payouts_enabled ?? false) && account.capabilities?.transfers === 'active',
        stripeDetailsSubmitted: account.details_submitted ?? false,
      },
    });
    return sellerProfileDto(updated);
  }
}
