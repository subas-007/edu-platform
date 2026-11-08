import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AUTHENTICATED_ONLY_KEY,
  AuthenticatedRequest,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
} from '../decorators/access.decorators';
import { Permission, roleHasPermission } from '../security/permissions';

/**
 * Global guard #2: RBAC. DENY BY DEFAULT — a non-public route that declares
 * neither @RequirePermissions nor @AuthenticatedOnly is rejected, so a forgotten
 * decorator fails closed instead of open.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const { user, method, path } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);

    if (!required || required.length === 0) {
      if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, targets)) return true;
      this.logger.error(`Route ${method} ${path} has no access policy; denying.`);
      throw new ForbiddenException();
    }

    if (!required.every((permission) => roleHasPermission(user.role, permission))) {
      throw new ForbiddenException();
    }
    return true;
  }
}
