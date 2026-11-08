import { Controller, Get, Module, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators/access.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Permission } from '../common/security/permissions';
import { PrismaService } from '../prisma/prisma.service';

const listAuditLogsQuerySchema = z
  .object({
    action: z.string().trim().max(100).optional(),
    actorId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

@Controller('audit-logs')
@RequirePermissions(Permission.AuditLogsRead)
export class AuditLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listAuditLogs(
    @Query(new ZodValidationPipe(listAuditLogsQuerySchema)) query: ListAuditLogsQuery,
  ) {
    const where: Prisma.AuditLogWhereInput = {
      action: query.action ? { startsWith: query.action } : undefined,
      actorId: query.actorId,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { email: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}

@Module({ controllers: [AuditLogsController] })
export class AuditLogsModule {}
