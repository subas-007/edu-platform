import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { ACCESS_TOKEN_COOKIE } from '../../auth/auth-cookies';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequest, IS_PUBLIC_KEY } from '../decorators/access.decorators';

interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  ver: number;
}

/**
 * Global guard #1: authenticates every request unless marked @Public().
 * Zero-trust: the token is only a pointer — role, active flag and token version
 * are re-read from the database so revocations take effect immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = request.cookies?.[ACCESS_TOKEN_COOKIE];
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException();
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true, tokenVersion: true },
    });
    if (!user || !user.isActive || user.tokenVersion !== payload.ver) {
      throw new UnauthorizedException();
    }

    request.user = { id: user.id, email: user.email, role: user.role };
    return true;
  }
}
