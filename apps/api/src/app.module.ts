import { BullModule } from '@nestjs/bullmq';
import { Controller, Get, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LlmModule } from './ai/llm.service';
import { AiSettingsModule } from './ai-settings/ai-settings.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditLogModule } from './audit/audit-log.service';
import { AuditLogsModule } from './audit/audit-logs.controller';
import { AuthModule } from './auth/auth.module';
import { Public } from './common/decorators/access.decorators';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { OriginCheckMiddleware } from './common/guards/origin-check.middleware';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { ExamPapersModule } from './exam-papers/exam-papers.module';
import { ExamQuestionsModule } from './exam-questions/exam-questions.module';
import { ExamSessionsModule } from './exam-sessions/exam-sessions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.service';
import { buildRedisConnection } from './queues/queue-names';
import { StudyMaterialsModule } from './study-materials/study-materials.module';
import { StudyRoadmapsModule } from './study-roadmaps/study-roadmaps.module';
import { TutorModule } from './tutor/tutor.module';
import { UsersModule } from './users/users.module';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  getHealth() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    // Per-IP rate limit. For multiple API replicas, back this with Redis storage.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    BullModule.forRoot({ connection: buildRedisConnection() }),
    PrismaModule,
    AuditLogModule,
    LlmModule,
    AuthModule,
    UsersModule,
    AuditLogsModule,
    StudyMaterialsModule,
    TutorModule,
    AiSettingsModule,
    ExamQuestionsModule,
    ExamSessionsModule,
    ExamPapersModule,
    NotificationsModule,
    AnalyticsModule,
    StudyRoadmapsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate-limit → authenticate → authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(OriginCheckMiddleware).forRoutes('{*splat}'); // Nest 11 / path-to-regexp v8 wildcard syntax
  }
}
