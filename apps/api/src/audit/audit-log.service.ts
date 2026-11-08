import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId: string | null;
  action: string; // e.g. "user.deactivated", "material.published"
  resourceType: string;
  resourceId?: string;
  metadata?: Prisma.InputJsonObject;
  ipAddress?: string;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Never throws: an audit failure is logged loudly but must not break the request. */
  async recordAuditEvent(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: entry });
    } catch (error) {
      this.logger.error(`Failed to write audit event ${entry.action}`, error as Error);
    }
  }
}

@Global()
@Module({ providers: [AuditLogService], exports: [AuditLogService] })
export class AuditLogModule {}
