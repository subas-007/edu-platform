import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { Prisma, QuestionReviewStatus, QuestionType } from '@prisma/client';
import { z } from 'zod';
import { AuditLogService } from '../audit/audit-log.service';
import {
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { ZodValidationPipe, zodBody } from '../common/pipes/zod-validation.pipe';
import { Permission } from '../common/security/permissions';
import { sanitizedText, uuidParam } from '../common/validation';
import { normaliseConceptTag } from '../generation/generation.schemas';
import { PrismaService } from '../prisma/prisma.service';

const optionId = z.enum(['A', 'B', 'C', 'D', 'E']);

const listQuestionsQuerySchema = z
  .object({
    materialId: z.string().uuid().optional(),
    reviewStatus: z.nativeEnum(QuestionReviewStatus).optional(),
    conceptTag: z.string().max(60).optional(),
    search: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
type ListQuestionsQuery = z.infer<typeof listQuestionsQuerySchema>;

const updateQuestionSchema = z
  .object({
    reviewStatus: z.nativeEnum(QuestionReviewStatus).optional(),
    questionType: z.nativeEnum(QuestionType).optional(),
    questionText: sanitizedText(1500).optional(),
    options: z
      .array(z.object({ id: optionId, text: sanitizedText(500) }).strict())
      .min(3)
      .max(5)
      .optional(),
    correctAnswer: optionId.optional(),
    explanation: sanitizedText(2000).optional(),
    conceptTag: sanitizedText(60).transform(normaliseConceptTag).optional(),
  })
  .strict();
type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

@Injectable()
export class ExamQuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async listQuestions(query: ListQuestionsQuery) {
    const where: Prisma.ExamQuestionWhereInput = {
      materialId: query.materialId,
      reviewStatus: query.reviewStatus,
      conceptTag: query.conceptTag,
      questionText: query.search ? { contains: query.search, mode: 'insensitive' } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.examQuestion.findMany({
        where,
        include: { material: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.examQuestion.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /**
   * The question bank grouped by source resource: counts per review status and the
   * concept tags covered, so examiners can browse and assemble papers per resource.
   */
  async summariseBankByResource() {
    const [byStatus, byConcept] = await Promise.all([
      this.prisma.examQuestion.groupBy({ by: ['materialId', 'reviewStatus'], _count: { _all: true } }),
      this.prisma.examQuestion.groupBy({
        by: ['materialId', 'conceptTag'],
        where: { reviewStatus: QuestionReviewStatus.APPROVED },
        _count: { _all: true },
      }),
    ]);
    const materialIds = [...new Set(byStatus.map((r) => r.materialId))];
    const materials = await this.prisma.material.findMany({
      where: { id: { in: materialIds } },
      select: { id: true, title: true, fileType: true, visibility: true, createdAt: true, reusedFromId: true },
      orderBy: { createdAt: 'desc' },
    });
    return materials.map((m) => {
      const count = (status: QuestionReviewStatus) =>
        byStatus.find((r) => r.materialId === m.id && r.reviewStatus === status)?._count._all ?? 0;
      const approved = count(QuestionReviewStatus.APPROVED);
      const pending = count(QuestionReviewStatus.PENDING);
      const rejected = count(QuestionReviewStatus.REJECTED);
      return {
        ...m,
        counts: { approved, pending, rejected, total: approved + pending + rejected },
        concepts: byConcept
          .filter((r) => r.materialId === m.id)
          .map((r) => ({ conceptTag: r.conceptTag, approved: r._count._all }))
          .sort((a, b) => b.approved - a.approved),
      };
    });
  }

  async curateQuestion(actor: AuthenticatedUser, questionId: string, input: UpdateQuestionInput) {
    const existing = await this.prisma.examQuestion.findUnique({ where: { id: questionId } });
    if (!existing) throw new NotFoundException();

    const options = (input.options ?? existing.options) as { id: string }[];
    const correctAnswer = input.correctAnswer ?? existing.correctAnswer;
    const ids = options.map((o) => o.id);
    if (new Set(ids).size !== ids.length || !ids.includes(correctAnswer)) {
      throw new BadRequestException('correctAnswer must match exactly one unique option id');
    }

    const updated = await this.prisma.examQuestion.update({
      where: { id: questionId },
      data: { ...input, options: input.options },
    });
    await this.auditLog.recordAuditEvent({
      actorId: actor.id,
      action: 'question.curated',
      resourceType: 'exam_question',
      resourceId: questionId,
      metadata: { changedFields: Object.keys(input) },
    });
    return updated;
  }
}

@Controller('exam-questions')
@RequirePermissions(Permission.QuestionsCurate)
export class ExamQuestionsController {
  constructor(private readonly service: ExamQuestionsService) {}

  @Get()
  listQuestions(@Query(new ZodValidationPipe(listQuestionsQuerySchema)) query: ListQuestionsQuery) {
    return this.service.listQuestions(query);
  }

  @Get('resources')
  summariseBankByResource() {
    return this.service.summariseBankByResource();
  }

  @Patch(':questionId')
  curateQuestion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('questionId', uuidParam) questionId: string,
    @Body(zodBody(updateQuestionSchema)) body: UpdateQuestionInput,
  ) {
    return this.service.curateQuestion(actor, questionId, body);
  }
}

@Module({ controllers: [ExamQuestionsController], providers: [ExamQuestionsService] })
export class ExamQuestionsModule {}
