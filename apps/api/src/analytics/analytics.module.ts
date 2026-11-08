import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators/access.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Permission } from '../common/security/permissions';
import { PrismaService } from '../prisma/prisma.service';

const analyticsQuerySchema = z
  .object({
    materialId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

const toNumber = (v: unknown) => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));

@Injectable()
export class PerformanceAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Questions students get wrong most often, with the most common wrong option. */
  async findFrequentlyMissedQuestions({ materialId, limit }: AnalyticsQuery) {
    const materialFilter = materialId
      ? Prisma.sql`AND q.material_id = ${materialId}::uuid`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT q.id AS "questionId", q.question_text AS "questionText", q.concept_tag AS "conceptTag",
             q.correct_answer AS "correctAnswer", m.id AS "materialId", m.title AS "materialTitle",
             COUNT(*) AS "attemptCount",
             COUNT(*) FILTER (WHERE NOT a.is_correct) AS "incorrectCount",
             MODE() WITHIN GROUP (ORDER BY a.selected_answer) FILTER (WHERE NOT a.is_correct)
               AS "mostCommonWrongAnswer"
        FROM exam_answers a
        JOIN exam_questions q ON q.id = a.question_id
        JOIN materials m      ON m.id = q.material_id
       WHERE TRUE ${materialFilter}
       GROUP BY q.id, m.id
      HAVING COUNT(*) FILTER (WHERE NOT a.is_correct) > 0
       ORDER BY "incorrectCount" DESC, "attemptCount" DESC
       LIMIT ${limit}`;
    return rows.map((r) => ({
      ...r,
      attemptCount: toNumber(r.attemptCount),
      incorrectCount: toNumber(r.incorrectCount),
      errorRate: toNumber(r.incorrectCount) / Math.max(1, toNumber(r.attemptCount)),
    }));
  }

  /** Cohort-wide accuracy per concept tag (weakest first). */
  async findConceptWeaknesses({ materialId, limit }: AnalyticsQuery) {
    const materialFilter = materialId
      ? Prisma.sql`AND q.material_id = ${materialId}::uuid`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT q.concept_tag AS "conceptTag",
             COUNT(*) AS "attemptCount",
             AVG(CASE WHEN a.is_correct THEN 1.0 ELSE 0.0 END) AS accuracy
        FROM exam_answers a
        JOIN exam_questions q ON q.id = a.question_id
       WHERE TRUE ${materialFilter}
       GROUP BY q.concept_tag
       ORDER BY accuracy ASC
       LIMIT ${limit}`;
    return rows.map((r) => ({
      conceptTag: r.conceptTag,
      attemptCount: toNumber(r.attemptCount),
      accuracy: Math.round(toNumber(r.accuracy) * 100) / 100,
    }));
  }

  /** Average formal-exam score per material. */
  async summariseMaterialPerformance() {
    const grouped = await this.prisma.examSession.groupBy({
      by: ['materialId'],
      where: { mode: 'EXAM', status: { in: ['SUBMITTED', 'EXPIRED'] } },
      _avg: { score: true },
      _count: { _all: true },
    });
    const materials = await this.prisma.material.findMany({
      where: { id: { in: grouped.map((g) => g.materialId) } },
      select: { id: true, title: true },
    });
    const titleById = new Map(materials.map((m) => [m.id, m.title]));
    return grouped.map((g) => ({
      materialId: g.materialId,
      materialTitle: titleById.get(g.materialId) ?? 'Unknown',
      averageScore: Math.round((g._avg.score ?? 0) * 10) / 10,
      completedExams: g._count._all,
    }));
  }
}

@Controller('analytics')
@RequirePermissions(Permission.AnalyticsRead)
export class PerformanceAnalyticsController {
  constructor(private readonly analytics: PerformanceAnalyticsService) {}

  @Get('frequently-missed-questions')
  getFrequentlyMissedQuestions(@Query(new ZodValidationPipe(analyticsQuerySchema)) q: AnalyticsQuery) {
    return this.analytics.findFrequentlyMissedQuestions(q);
  }

  @Get('concept-weaknesses')
  getConceptWeaknesses(@Query(new ZodValidationPipe(analyticsQuerySchema)) q: AnalyticsQuery) {
    return this.analytics.findConceptWeaknesses(q);
  }

  @Get('material-performance')
  getMaterialPerformance() {
    return this.analytics.summariseMaterialPerformance();
  }
}

@Module({ controllers: [PerformanceAnalyticsController], providers: [PerformanceAnalyticsService] })
export class AnalyticsModule {}
