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
