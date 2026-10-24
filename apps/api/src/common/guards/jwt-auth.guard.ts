import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser, IS_PUBLIC, REQUIRE_VERIFIED_EMAIL, ROLES } from '../decorators/auth.decorators';
import type { UserRole } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

/**
 * Garde globale : vérifie le JWT d'accès, puis recharge l'utilisateur en base pour
 * que les suspensions / changements de rôle prennent effet immédiatement.
 * Le rôle provient toujours de la base, jamais de la requête.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ?? false;
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = extractBearer(req.headers.authorization);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Authentification requise');
    }

    const user = await this.resolve(token).catch((e: unknown) => {
      if (isPublic) return undefined;
      throw e;
    });
    if (user) req.user = user;
    if (isPublic) return true;
    if (!user) throw new UnauthorizedException('Authentification requise');

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, targets);
    if (roles && roles.length > 0 && !roles.includes(user.role)) {
      throw new ForbiddenException('Droits insuffisants');
    }
    const needsVerified = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_VERIFIED_EMAIL,
      targets,
    );
    if (needsVerified && !user.emailVerified) {
      throw new ForbiddenException({
        message: 'Veuillez vérifier votre adresse email pour effectuer cette action',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }
    return true;
  }

  async resolve(token: string): Promise<AuthUser> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Jeton invalide ou expiré');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true, emailVerifiedAt: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Compte inactif');
    }
    return { id: user.id, role: user.role, emailVerified: user.emailVerifiedAt !== null };
  }
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
