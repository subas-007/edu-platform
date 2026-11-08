import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { Permission } from '../security/permissions';

export const IS_PUBLIC_KEY = 'access:isPublic';
export const PERMISSIONS_KEY = 'access:permissions';
export const AUTHENTICATED_ONLY_KEY = 'access:authenticatedOnly';

/** Route requires no authentication (login, refresh, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Route requires ALL listed permissions. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Route requires a valid session but no specific permission (e.g. GET /auth/me). */
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY_KEY, true);

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
