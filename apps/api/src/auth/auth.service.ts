import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuditLogService } from '../audit/audit-log.service';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { LoginInput } from './auth.schemas';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  user: Pick<User, 'id' | 'email' | 'role'>;
}

const hashRefreshToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  /** Used to equalise timing when the e-mail does not exist (prevents user enumeration). */
  private readonly dummyPasswordHash = argon2.hash('timing-equaliser-not-a-password', {
    type: argon2.argon2id,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditLog: AuditLogService,
  ) {}

  async authenticateWithPassword(input: LoginInput, ipAddress?: string): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const passwordValid = await argon2.verify(
      user?.passwordHash ?? (await this.dummyPasswordHash),
      input.password,
    );

    if (!user || !passwordValid || !user.isActive) {
      await this.auditLog.recordAuditEvent({
        actorId: user?.id ?? null,
        action: 'auth.login_failed',
        resourceType: 'user',
        resourceId: user?.id,
        ipAddress,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.auditLog.recordAuditEvent({
      actorId: user.id,
      action: 'auth.login_succeeded',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress,
    });
    return this.issueTokenPair(user, randomUUID());
  }

  /**
   * Rotating refresh tokens with reuse detection: presenting an already-rotated
   * token means it was stolen, so the whole token family is revoked.
   */
  async rotateRefreshToken(rawToken: string | undefined): Promise<IssuedTokens> {
    if (!rawToken) throw new UnauthorizedException();
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
      include: { user: true },
    });
    if (!stored) throw new UnauthorizedException();

    if (stored.revokedAt) {
      await this.revokeTokenFamily(stored.familyId);
      await this.auditLog.recordAuditEvent({
        actorId: stored.userId,
        action: 'auth.refresh_token_reuse_detected',
        resourceType: 'user',
        resourceId: stored.userId,
      });
      throw new UnauthorizedException();
    }
    if (stored.expiresAt < new Date() || !stored.user.isActive) {
      throw new UnauthorizedException();
    }

    // Conditional update guards against two concurrent refreshes both succeeding.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new UnauthorizedException();

    return this.issueTokenPair(stored.user, stored.familyId);
  }

  async revokeRefreshToken(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
    });
    if (stored) await this.revokeTokenFamily(stored.familyId);
  }

  /** Public profile for GET /auth/me (never includes hashes or token versions). */
  getProfile(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, role: true },
    });
  }

  /** Called when a user is deactivated or their role changes. */
  async revokeAllSessionsForUser(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
    ]);
  }

  private async revokeTokenFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokenPair(user: User, familyId: string): Promise<IssuedTokens> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      role: user.role,
      ver: user.tokenVersion,
    });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000),
      },
    });
    return { accessToken, refreshToken, user: { id: user.id, email: user.email, role: user.role } };
  }
}
