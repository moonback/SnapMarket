import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  role: UserRole;
  emailVerified: boolean;
}

export const IS_PUBLIC = 'isPublic';
/** Route accessible sans authentification (l'utilisateur est tout de même résolu si un jeton est fourni). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

export const REQUIRE_VERIFIED_EMAIL = 'requireVerifiedEmail';
/** Exige une adresse email vérifiée (actions engageantes : vendre, payer, écrire). */
export const VerifiedEmail = () => SetMetadata(REQUIRE_VERIFIED_EMAIL, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    return req.user;
  },
);
