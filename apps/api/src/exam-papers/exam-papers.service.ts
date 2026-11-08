import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ExamMode,
  ExamPaperStatus,
  ExamSessionStatus,
  Prisma,
  QuestionReviewStatus,
} from '@prisma/client';
import { AuditLogService } from '../audit/audit-log.service';
import { AuthenticatedUser } from '../common/decorators/access.decorators';
import { cryptoShuffle, isCertificateEligible } from '../exam-sessions/exam-sessions.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExamPaperInput, ListExamPapersQuery, UpdateExamPaperInput } from './exam-papers.schemas';

const CLOSED_STATUSES: ExamSessionStatus[] = [ExamSessionStatus.SUBMITTED, ExamSessionStatus.EXPIRED];

/** Allowed lifecycle moves; anything else is rejected. */
const TRANSITIONS: Record<ExamPaperStatus, ExamPaperStatus[]> = {
  DRAFT: [ExamPaperStatus.PUBLISHED],
  PUBLISHED: [ExamPaperStatus.CLOSED, ExamPaperStatus.DRAFT],
  CLOSED: [ExamPaperStatus.PUBLISHED, ExamPaperStatus.DRAFT],
};

@Injectable()
export class ExamPapersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---------------------------------------------------------------- examiner

  async listPapers(query: ListExamPapersQuery) {
    const where: Prisma.ExamPaperWhereInput = { status: query.status };
    const [papers, total] = await this.prisma.$transaction([
      this.prisma.examPaper.findMany({
        where,
        include: {
          createdBy: { select: { email: true, fullName: true } },
          _count: { select: { enrollments: true, sessions: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.examPaper.count({ where }),
    ]);
    const scores = await this.prisma.examSession.groupBy({
      by: ['paperId'],
      where: { paperId: { in: papers.map((p) => p.id) }, status: { in: CLOSED_STATUSES } },
      _avg: { score: true },
      _count: { _all: true },
    });
    const scoreByPaper = new Map(scores.map((s) => [s.paperId, s]));
    return {
      items: papers.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        status: p.status,
        durationMinutes: p.durationMinutes,
        maxAttempts: p.maxAttempts,
        questionCount: p.questionIds.length,
        resourceCount: p.materialIds.length,
        createdBy: p.createdBy,
        createdAt: p.createdAt,
        publishedAt: p.publishedAt,
        enrollmentCount: p._count.enrollments,
        attemptCount: p._count.sessions,
        completedAttemptCount: scoreByPaper.get(p.id)?._count._all ?? 0,
        averageScore: round1(scoreByPaper.get(p.id)?._avg.score ?? null),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Builds the paper from the existing question bank only (no LLM calls): questions are
   * drawn round-robin across the chosen resources so every resource is represented.
   */
  async createPaper(actor: AuthenticatedUser, input: CreateExamPaperInput) {
    const materialIds = [...new Set(input.materialIds)];
    const materials = await this.prisma.material.findMany({
      where: { id: { in: materialIds } },
      select: { id: true },
    });
    if (materials.length !== materialIds.length) throw new NotFoundException('One or more resources were not found');

    const bank = await this.prisma.examQuestion.findMany({
      where: {
        materialId: { in: materialIds },
        reviewStatus: QuestionReviewStatus.APPROVED,
        ...(input.conceptTags?.length ? { conceptTag: { in: input.conceptTags } } : {}),
      },
      select: { id: true, materialId: true },
    });
    if (bank.length === 0) {
      throw new UnprocessableEntityException(
        'The selected resources have no approved questions yet. Approve questions in the question bank first.',
      );
    }

    const pools = materialIds
      .map((id) => cryptoShuffle(bank.filter((q) => q.materialId === id).map((q) => q.id)))
      .filter((pool) => pool.length > 0);
    const questionIds: string[] = [];
    while (questionIds.length < input.questionCount && pools.some((p) => p.length > 0)) {
      for (const pool of pools) {
        const next = pool.pop();
        if (next) questionIds.push(next);
        if (questionIds.length === input.questionCount) break;
      }
    }

    const paper = await this.prisma.examPaper.create({
      data: {
        title: input.title,
        description: input.description,
        durationMinutes: input.durationMinutes,
        maxAttempts: input.maxAttempts,
        questionIds,
        materialIds,
        createdById: actor.id,
      },
    });
    await this.auditLog.recordAuditEvent({
      actorId: actor.id,
      action: 'exam_paper.created',
      resourceType: 'exam_paper',
      resourceId: paper.id,
      metadata: { requested: input.questionCount, selected: questionIds.length, resources: materialIds.length },
    });
    return { ...(await this.getPaperDetail(paper.id)), requestedQuestionCount: input.questionCount };
  }

  /** Staff view: full questions including answer keys, plus per-student results. */
  async getPaperDetail(paperId: string) {
    const paper = await this.prisma.examPaper.findUnique({
      where: { id: paperId },
      include: { createdBy: { select: { email: true, fullName: true } } },
    });
    if (!paper) throw new NotFoundException();

    const [questions, materials, enrollments, sessions] = await Promise.all([
      this.prisma.examQuestion.findMany({
        where: { id: { in: paper.questionIds } },
        include: { material: { select: { id: true, title: true } } },
      }),
      this.prisma.material.findMany({
        where: { id: { in: paper.materialIds } },
        select: { id: true, title: true },
      }),
      this.prisma.examEnrollment.findMany({
        where: { paperId },
        include: { student: { select: { id: true, email: true, fullName: true } } },
        orderBy: { enrolledAt: 'asc' },
      }),
      this.prisma.examSession.findMany({
        where: { paperId },
        select: { id: true, studentId: true, status: true, score: true, mode: true, completedAt: true },
      }),
    ]);
    const questionById = new Map(questions.map((q) => [q.id, q]));
    const closed = sessions.filter((s) => CLOSED_STATUSES.includes(s.status));

    return {
      id: paper.id,
      title: paper.title,
      description: paper.description,
      status: paper.status,
      durationMinutes: paper.durationMinutes,
      maxAttempts: paper.maxAttempts,
      createdBy: paper.createdBy,
      createdAt: paper.createdAt,
      publishedAt: paper.publishedAt,
      materials,
      questions: paper.questionIds.flatMap((id) => {
        const q = questionById.get(id);
        if (!q) return [];
        return [
          {
            id: q.id,
            questionType: q.questionType,
            questionText: q.questionText,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
            conceptTag: q.conceptTag,
            reviewStatus: q.reviewStatus,
            material: q.material,
          },
        ];
      }),
      stats: {
        enrollmentCount: enrollments.length,
        attemptCount: sessions.length,
        completedAttemptCount: closed.length,
        averageScore: round1(closed.length ? closed.reduce((s, x) => s + (x.score ?? 0), 0) / closed.length : null),
        certificatesIssued: closed.filter((s) => isCertificateEligible(s)).length,
      },
      candidates: enrollments.map((e) => {
        const mine = closed.filter((s) => s.studentId === e.student.id);
        const best = mine.reduce<number | null>((b, s) => (b === null || (s.score ?? 0) > b ? (s.score ?? 0) : b), null);
        return {
          studentId: e.student.id,
          email: e.student.email,
          fullName: e.student.fullName,
          enrolledAt: e.enrolledAt,
          attempts: sessions.filter((s) => s.studentId === e.student.id).length,
          bestScore: best,
          certified: mine.some((s) => isCertificateEligible(s)),
        };
      }),
    };
  }

  async updatePaper(actor: AuthenticatedUser, paperId: string, input: UpdateExamPaperInput) {
    const paper = await this.prisma.examPaper.findUnique({
      where: { id: paperId },
      include: { _count: { select: { sessions: true } } },
    });
    if (!paper) throw new NotFoundException();
    const data: Prisma.ExamPaperUpdateInput = {
      title: input.title,
      description: input.description,
      durationMinutes: input.durationMinutes,
      maxAttempts: input.maxAttempts,
    };

    if (input.questionIds) {
      if (paper.status !== ExamPaperStatus.DRAFT) {
        throw new ConflictException('Move the program back to draft before changing its questions');
      }
      const ids = [...new Set(input.questionIds)];
      const approved = await this.prisma.examQuestion.findMany({
        where: { id: { in: ids }, reviewStatus: QuestionReviewStatus.APPROVED },
        select: { id: true, materialId: true },
      });
      if (approved.length !== ids.length) {
        throw new BadRequestException('Every question must exist in the bank and be APPROVED');
      }
      data.questionIds = ids;
      data.materialIds = [...new Set(approved.map((q) => q.materialId))];
    }

    if (input.status && input.status !== paper.status) {
      if (!TRANSITIONS[paper.status].includes(input.status)) {
        throw new ConflictException(`Cannot move a ${paper.status} program to ${input.status}`);
      }
      if (input.status === ExamPaperStatus.DRAFT && paper._count.sessions > 0) {
        throw new ConflictException('Students have already attempted this program; close it instead');
      }
      if (input.status === ExamPaperStatus.PUBLISHED) {
        const questionCount = (input.questionIds ?? paper.questionIds).length;
        if (questionCount === 0) throw new ConflictException('Add questions before publishing');
        data.publishedAt = paper.publishedAt ?? new Date();
      }
      data.status = input.status;
    }

    await this.prisma.examPaper.update({ where: { id: paperId }, data });
    await this.auditLog.recordAuditEvent({
      actorId: actor.id,
      action: input.status && input.status !== paper.status ? `exam_paper.${input.status.toLowerCase()}` : 'exam_paper.updated',
      resourceType: 'exam_paper',
      resourceId: paperId,
      metadata: { changedFields: Object.keys(input) },
    });
    return this.getPaperDetail(paperId);
  }

  async deletePaper(actor: AuthenticatedUser, paperId: string) {
    const paper = await this.prisma.examPaper.findUnique({
      where: { id: paperId },
      include: { _count: { select: { sessions: true } } },
    });
    if (!paper) throw new NotFoundException();
    if (paper._count.sessions > 0) {
      throw new ConflictException('Programs with attempts are kept for the record; close it instead');
    }
    await this.prisma.examPaper.delete({ where: { id: paperId } });
    await this.auditLog.recordAuditEvent({
      actorId: actor.id,
      action: 'exam_paper.deleted',
      resourceType: 'exam_paper',
      resourceId: paperId,
      metadata: { title: paper.title },
    });
  }

  // ----------------------------------------------------------------- student

  /** Published programs plus any the student is enrolled in (even if closed). */
  async listAvailablePrograms(user: AuthenticatedUser) {
    const papers = await this.prisma.examPaper.findMany({
      where: {
        OR: [
          { status: ExamPaperStatus.PUBLISHED },
          { status: ExamPaperStatus.CLOSED, enrollments: { some: { studentId: user.id } } },
        ],
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const [enrollments, sessions] = await Promise.all([
      this.prisma.examEnrollment.findMany({
        where: { studentId: user.id, paperId: { in: papers.map((p) => p.id) } },
      }),
      this.prisma.examSession.findMany({
        where: { studentId: user.id, paperId: { in: papers.map((p) => p.id) } },
        select: { id: true, paperId: true, status: true, score: true, mode: true, expiresAt: true, startedAt: true },
        orderBy: { startedAt: 'desc' },
      }),
    ]);
    const enrolledAt = new Map(enrollments.map((e) => [e.paperId, e.enrolledAt]));
    return papers.map((p) => this.toStudentProgramView(p, enrolledAt.get(p.id) ?? null, sessions.filter((s) => s.paperId === p.id)));
  }

  async enroll(user: AuthenticatedUser, paperId: string) {
    const paper = await this.prisma.examPaper.findUnique({ where: { id: paperId } });
    if (!paper || paper.status !== ExamPaperStatus.PUBLISHED) throw new NotFoundException();
    await this.prisma.examEnrollment.upsert({
      where: { paperId_studentId: { paperId, studentId: user.id } },
      create: { paperId, studentId: user.id },
      update: {},
    });
    return (await this.listAvailablePrograms(user)).find((p) => p.id === paperId);
  }

  private toStudentProgramView(
    p: { id: string; title: string; description: string; status: ExamPaperStatus; durationMinutes: number; maxAttempts: number; questionIds: string[]; publishedAt: Date | null },
    enrolledAt: Date | null,
    sessions: Array<{ id: string; status: ExamSessionStatus; score: number | null; mode: ExamMode; expiresAt: Date | null }>,
  ) {
    const closed = sessions.filter((s) => CLOSED_STATUSES.includes(s.status));
    const active = sessions.find(
      (s) => s.status === ExamSessionStatus.IN_PROGRESS && (!s.expiresAt || s.expiresAt.getTime() > Date.now()),
    );
    const best = closed.reduce<(typeof closed)[number] | null>(
      (b, s) => (!b || (s.score ?? 0) > (b.score ?? 0) ? s : b),
      null,
    );
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      status: p.status,
      durationMinutes: p.durationMinutes,
      maxAttempts: p.maxAttempts,
      questionCount: p.questionIds.length,
      publishedAt: p.publishedAt,
      enrolled: enrolledAt !== null,
      enrolledAt,
      attemptsUsed: sessions.length,
      activeSessionId: active?.id ?? null,
      bestScore: best?.score ?? null,
      bestSessionId: best?.id ?? null,
      certificateSessionId: closed.find((s) => isCertificateEligible(s))?.id ?? null,
    };
  }
}

function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}
