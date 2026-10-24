import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EmailTokenPurpose, User } from '@prisma/client';
import { AuthTokens } from '@snapmarket/shared';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { AccessTokenPayload } from '../common/guards/jwt-auth.guard';
import { randomToken, sha256 } from '../common/utils/crypto';
import { RequestMeta } from '../common/utils/request';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/auth.dto';
import { PasswordService } from './password.service';

const EMAIL_TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  VERIFY_EMAIL: 24 * 3600 * 1000,
  RESET_PASSWORD: 3600 * 1000,
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(
    dto: RegisterDto,
    meta: RequestMeta,
  ): Promise<{ userId: string; tokens: AuthTokens }> {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email }, { username: { equals: dto.username, mode: 'insensitive' } }],
      },
      select: { email: true },
    });
    if (existing) {
      throw new ConflictException(
        existing.email === dto.email
          ? 'Cette adresse email est déjà utilisée'
          : 'Ce pseudonyme est déjà pris',
      );
    }
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        passwordHash: await this.passwords.hash(dto.password),
        termsAcceptedAt: new Date(),
      },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'auth.register',
      entityType: 'User',
      entityId: user.id,
      ip: meta.ip,
    });
    await this.sendVerificationEmail(user);
    return { userId: user.id, tokens: await this.issueTokens(user, meta) };
  }

  async login(
    email: string,
    password: string,
    meta: RequestMeta,
  ): Promise<{ userId: string; tokens: AuthTokens }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const invalid = new UnauthorizedException('Email ou mot de passe incorrect');

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      // On effectue tout de même la vérification pour un temps de réponse homogène.
      await this.passwords.verify(user.passwordHash, password);
      throw new ForbiddenException({
        message: 'Trop de tentatives. Réessayez plus tard ou réinitialisez votre mot de passe.',
        code: 'ACCOUNT_LOCKED',
      });
    }

    const ok = await this.passwords.verify(user?.passwordHash ?? null, password);
    if (!user || !ok) {
      if (user) await this.registerFailure(user, meta);
      throw invalid;
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException({
        message: 'Ce compte n’est pas actif',
        code: 'ACCOUNT_INACTIVE',
      });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      ip: meta.ip,
    });
    return { userId: user.id, tokens: await this.issueTokens(user, meta) };
  }

  private async registerFailure(user: User, meta: RequestMeta): Promise<void> {
    const count = user.failedLoginCount + 1;
    const lock = count >= this.config.login.maxFailedAttempts;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : count,
        lockedUntil: lock
          ? new Date(Date.now() + this.config.login.lockMinutes * 60_000)
          : undefined,
      },
    });
    if (lock) {
      await this.audit.log({
        actorId: user.id,
        action: 'auth.locked',
        entityType: 'User',
        entityId: user.id,
        ip: meta.ip,
      });
    }
  }

  /**
   * Rotation du refresh token : l'ancien est révoqué, un nouveau est émis dans la même
   * famille. La présentation d'un jeton déjà révoqué (vol probable) révoque toute la famille.
   */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthTokens> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!stored) throw new UnauthorizedException('Session invalide');
    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log({
        actorId: stored.userId,
        action: 'auth.refresh_reuse_detected',
        entityType: 'RefreshToken',
        entityId: stored.id,
        ip: meta.ip,
      });
      throw new UnauthorizedException('Session révoquée');
    }
    if (stored.expiresAt < new Date() || stored.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Session expirée');
    }
    // Révocation conditionnelle : protège contre deux rafraîchissements simultanés.
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) throw new UnauthorizedException('Session révoquée');
    const tokens = await this.issueTokens(stored.user, meta, stored.familyId);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { replacedBy: sha256(tokens.refreshToken) },
    });
    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async sendVerificationEmail(user: Pick<User, 'id' | 'email' | 'emailVerifiedAt'>): Promise<void> {
    if (user.emailVerifiedAt) return;
    const token = await this.createEmailToken(user.id, 'VERIFY_EMAIL');
    const link = `${this.config.apiPublicUrl}/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`;
    await this.mail.enqueue(this.mail.verificationEmail(user.email, link));
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) throw new BadRequestException('Adresse email déjà vérifiée');
    await this.sendVerificationEmail(user);
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.consumeEmailToken(token, 'VERIFY_EMAIL');
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    });
    await this.audit.log({
      actorId: record.userId,
      action: 'auth.email_verified',
      entityType: 'User',
      entityId: record.userId,
    });
  }

  /** Réponse identique que le compte existe ou non (pas d'énumération). */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status === 'DELETED' || user.status === 'BANNED') return;
    const token = await this.createEmailToken(user.id, 'RESET_PASSWORD');
    const link = `${this.config.appPublicUrl}reset-password?token=${encodeURIComponent(token)}`;
    await this.mail.enqueue(this.mail.resetPasswordEmail(user.email, link));
  }

  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    const record = await this.consumeEmailToken(token, 'RESET_PASSWORD');
    await this.prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await this.passwords.hash(password),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.logoutAll(record.userId);
    await this.audit.log({
      actorId: record.userId,
      action: 'auth.password_reset',
      entityType: 'User',
      entityId: record.userId,
      ip: meta.ip,
    });
  }

  async changePassword(
    userId: string,
    current: string,
    next: string,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(user.passwordHash, current))) {
      throw new UnauthorizedException('Mot de passe actuel incorrect');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(next) },
    });
    await this.logoutAll(userId);
    await this.audit.log({
      actorId: userId,
      action: 'auth.password_changed',
      entityType: 'User',
      entityId: userId,
      ip: meta.ip,
    });
  }

  private async createEmailToken(userId: string, purpose: EmailTokenPurpose): Promise<string> {
    const token = randomToken();
    await this.prisma.$transaction([
      this.prisma.emailToken.updateMany({
        where: { userId, purpose, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.emailToken.create({
        data: {
          userId,
          purpose,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS[purpose]),
        },
      }),
    ]);
    return token;
  }

  private async consumeEmailToken(token: string, purpose: EmailTokenPurpose) {
    const record = await this.prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Lien invalide ou expiré');
    }
    const used = await this.prisma.emailToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count === 0) throw new BadRequestException('Lien invalide ou expiré');
    return record;
  }

  async issueTokens(
    user: Pick<User, 'id' | 'role'>,
    meta: RequestMeta,
    familyId?: string,
  ): Promise<AuthTokens> {
    const payload: AccessTokenPayload = { sub: user.id, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.config.jwt.accessTtlSeconds,
    });
    const refreshToken = randomToken(48);
    const refreshExpires = new Date(Date.now() + this.config.jwt.refreshTtlDays * 86_400_000);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId: familyId ?? randomToken(16),
        expiresAt: refreshExpires,
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
    });
    return {
      accessToken,
      accessTokenExpiresAt: new Date(
        Date.now() + this.config.jwt.accessTtlSeconds * 1000,
      ).toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshExpires.toISOString(),
    };
  }
}
