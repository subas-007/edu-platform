import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuditLogService } from '../audit/audit-log.service';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedUser } from '../common/decorators/access.decorators';
import { UsersRepository } from './users.repository';
import { ListUsersQuery, ProvisionUserInput, UpdateUserInput } from './users.schemas';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly authService: AuthService,
    private readonly auditLog: AuditLogService,
  ) {}

  listUsers(query: ListUsersQuery) {
    return this.usersRepository.findUsersPage(query);
  }

  async provisionUser(input: ProvisionUserInput, actor: AuthenticatedUser, ip?: string) {
    const passwordHash = await argon2.hash(input.initialPassword, { type: argon2.argon2id });
    try {
      const user = await this.usersRepository.createUser({
        email: input.email,
        role: input.role,
        passwordHash,
      });
      await this.auditLog.recordAuditEvent({
        actorId: actor.id,
        action: 'user.provisioned',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { role: user.role },
        ipAddress: ip,
      });
      return user;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A user with this e-mail already exists');
      }
      throw error;
    }
  }

  async updateUser(userId: string, input: UpdateUserInput, actor: AuthenticatedUser, ip?: string) {
    if (userId === actor.id) {
      // Prevents an admin from locking the system out by demoting/deactivating themselves.
      throw new BadRequestException('Administrators cannot change their own role or status');
    }
    const existing = await this.usersRepository.findUserById(userId);
    if (!existing) throw new NotFoundException();

    const updated = await this.usersRepository.updateUser(userId, input);
    const privilegeChanged =
      (input.role !== undefined && input.role !== existing.role) || input.isActive === false;
    if (privilegeChanged) {
      await this.authService.revokeAllSessionsForUser(userId);
    }

    await this.auditLog.recordAuditEvent({
      actorId: actor.id,
      action: input.isActive === false ? 'user.deprovisioned' : 'user.updated',
      resourceType: 'user',
      resourceId: userId,
      metadata: {
        before: { role: existing.role, isActive: existing.isActive },
        after: { role: updated.role, isActive: updated.isActive },
      },
      ipAddress: ip,
    });
    return updated;
  }
}
