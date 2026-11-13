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
  ExamQuestion,
  ExamSession,
  ExamSessionStatus,
  Prisma,
  QuestionReviewStatus,
} from '@prisma/client';
import { randomInt } from 'node:crypto';
import { AuthenticatedUser } from '../common/decorators/access.decorators';
import { Permission, roleHasPermission } from '../common/security/permissions';
import {
  renderCertificatePdf,
  renderScorecardPdf,
  toFilenameStem,
} from '../documents/pdf-documents';
import { PrismaService } from '../prisma/prisma.service';
import { MaterialAccessPolicy } from '../study-materials/material-access.policy';
import { BrandingService } from '../branding/branding.service';
import {
  ConceptDiagnostic,
  ListMySessionsQuery,
  QuestionOption,
  StartExamSessionInput,
  SubmitAnswerInput,
} from './exam-sessions.schemas';

const SECONDS_PER_QUESTION = 90;
const WEAK_AREA_THRESHOLD = 0.7;
/** A certificate is issued for an exam-mode result strictly above this percentage. */
export const CERTIFICATE_MIN_SCORE_EXCLUSIVE = 70;

const CLOSED_STATUSES: ExamSessionStatus[] = [ExamSessionStatus.SUBMITTED, ExamSessionStatus.EXPIRED];

type Tx = Prisma.TransactionClient;

export function isCertificateEligible(session: Pick<ExamSession, 'mode' | 'status' | 'score'>): boolean {
  return (
    session.mode === ExamMode.EXAM &&
    CLOSED_STATUSES.includes(session.status) &&
    (session.score ?? 0) > CERTIFICATE_MIN_SCORE_EXCLUSIVE
  );
}

/** Student-safe projection: correctAnswer / explanation are NEVER included. */
const toStudentQuestionView = (q: ExamQuestion) => ({
  id: q.id,
  questionType: q.questionType,
  questionText: q.questionText,
  options: q.options as unknown as QuestionOption[],
});

@Injectable()
export class ExamSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicy: MaterialAccessPolicy,
    private readonly branding: BrandingService,
  ) {}

  async startExamSession(user: AuthenticatedUser, input: StartExamSessionInput) {
    await this.accessPolicy.getReadableMaterialOrThrow(user, input.materialId);

    const pool = await this.prisma.examQuestion.findMany({
      where: { materialId: input.materialId, reviewStatus: QuestionReviewStatus.APPROVED },
      select: { id: true },
    });
    if (pool.length === 0) {
      throw new UnprocessableEntityException('No approved questions are available for this material yet');
    }
    const questionIds = cryptoShuffle(pool.map((q) => q.id)).slice(0, input.questionCount);
    const startedAt = new Date();

    const session = await this.prisma.examSession.create({
      data: {
        studentId: user.id,
        materialId: input.materialId,
        mode: input.mode,
        questionIds,
        startedAt,
        expiresAt:
          input.mode === ExamMode.EXAM
            ? new Date(startedAt.getTime() + questionIds.length * SECONDS_PER_QUESTION * 1000)
            : null,
      },
    });
    return this.getExamSession(user, session.id);
  }

  /**
   * Starts a timed attempt of a published exam program. Enrollment and attempt limits are
   * checked under a row lock on the enrollment, so parallel clicks cannot exceed maxAttempts.
   * An attempt that is still running is resumed instead of creating a second one.
   */
  async startPaperSession(user: AuthenticatedUser, paperId: string) {
    const sessionId = await this.prisma.$transaction(async (tx) => {
      const [enrollment] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM exam_enrollments
         WHERE paper_id = ${paperId}::uuid AND student_id = ${user.id}::uuid FOR UPDATE`;
      const paper = await tx.examPaper.findUnique({ where: { id: paperId } });
      if (!paper || (paper.status !== ExamPaperStatus.PUBLISHED && !enrollment)) throw new NotFoundException();
      if (!enrollment) throw new ConflictException('Enroll in this exam program before starting it');
      if (paper.status !== ExamPaperStatus.PUBLISHED) {
        throw new ConflictException('This exam program is not open for attempts');
      }

      const previous = await tx.examSession.findMany({
        where: { paperId, studentId: user.id },
        select: { id: true, status: true, expiresAt: true },
      });
      const active = previous.find(
        (s) => s.status === ExamSessionStatus.IN_PROGRESS && (!s.expiresAt || s.expiresAt.getTime() > Date.now()),
      );
      if (active) return active.id;
      if (previous.length >= paper.maxAttempts) {
        throw new ConflictException('You have used all attempts for this exam program');
      }

      const available = await tx.examQuestion.findMany({
        where: { id: { in: paper.questionIds }, reviewStatus: QuestionReviewStatus.APPROVED },
        select: { id: true },
      });
      if (available.length === 0) {
        throw new UnprocessableEntityException('This exam program has no available questions');
      }
      const startedAt = new Date();
      const session = await tx.examSession.create({
        data: {
          studentId: user.id,
          paperId,
          mode: ExamMode.EXAM,
          questionIds: cryptoShuffle(available.map((q) => q.id)),
          startedAt,
          expiresAt: new Date(startedAt.getTime() + paper.durationMinutes * 60_000),
        },
      });
      return session.id;
    });
    return this.getExamSession(user, sessionId);
  }

  /** The student's own attempt history (practice + exam programs), newest first. */
  async listMySessions(user: AuthenticatedUser, query: ListMySessionsQuery) {
    const where: Prisma.ExamSessionWhereInput = {
      studentId: user.id,
      ...(query.status === 'completed' ? { status: { in: CLOSED_STATUSES } } : {}),
      ...(query.status === 'in-progress' ? { status: ExamSessionStatus.IN_PROGRESS } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.examSession.findMany({
        where,
        include: {
          material: { select: { title: true } },
          paper: { select: { title: true } },
        },
        orderBy: { startedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.examSession.count({ where }),
    ]);
    return {
      items: rows.map((s) => ({
        id: s.id,
        kind: s.paperId ? ('PROGRAM' as const) : ('PRACTICE' as const),
        title: s.paper?.title ?? s.material?.title ?? 'Deleted material',
        materialId: s.materialId,
        paperId: s.paperId,
        mode: s.mode,
        // Display-only: an overdue attempt is finalised the next time it is opened.
        status: this.isExpired(s) ? ExamSessionStatus.EXPIRED : s.status,
        score: s.score,
        correctCount: s.correctCount,
        totalQuestions: s.questionIds.length,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        certificateEligible: isCertificateEligible(s),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getExamSession(user: AuthenticatedUser, sessionId: string) {
    let session = await this.getOwnedSessionOrThrow(user, sessionId);
    if (this.isExpired(session)) {
      await this.finaliseSession(sessionId, ExamSessionStatus.EXPIRED);
      session = await this.getOwnedSessionOrThrow(user, sessionId);
    }

    const questions = await this.loadQuestionsInOrder(session.questionIds);
    const answers = await this.prisma.examAnswer.findMany({ where: { sessionId } });
    const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));
    const revealFeedback = session.mode === ExamMode.LEARNING || session.status !== ExamSessionStatus.IN_PROGRESS;
    // Exam-program questions are a reusable bank: after submission students see which
    // answers were right or wrong, but never the answer key or explanations.
    const revealAnswerKey = !session.paperId;
    const context = await this.loadSessionContext(session);

    return {
      id: session.id,
      kind: session.paperId ? 'PROGRAM' : 'PRACTICE',
      title: context.title,
      materialId: session.materialId,
      paperId: session.paperId,
      mode: session.mode,
      status: session.status,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      serverTime: new Date(), // lets the client correct timer drift
      questions: questions.map((q) => {
        const answer = answerByQuestion.get(q.id);
        return {
          ...toStudentQuestionView(q),
          selectedAnswer: answer?.selectedAnswer ?? null,
          feedback:
            answer && revealFeedback
              ? revealAnswerKey
                ? { isCorrect: answer.isCorrect, correctAnswer: q.correctAnswer, explanation: q.explanation }
                : { isCorrect: answer.isCorrect }
              : null,
        };
      }),
      result: session.status === ExamSessionStatus.IN_PROGRESS ? null : this.buildResultView(session),
    };
  }

  /**
   * LEARNING: evaluates immediately and returns a justification (one attempt per question).
   * EXAM: stores silently; answers may be changed until submission/expiry.
   */
  async recordAnswer(user: AuthenticatedUser, sessionId: string, input: SubmitAnswerInput) {
    return this.prisma.$transaction(async (tx) => {
      const session = await this.lockOwnedSession(tx, user, sessionId);
      if (session.status !== ExamSessionStatus.IN_PROGRESS) {
        throw new ConflictException('This session is already closed');
      }
      if (this.isExpired(session)) {
        await this.finaliseSessionInTx(tx, session, ExamSessionStatus.EXPIRED);
        throw new ConflictException('Time is up; the exam has been submitted automatically');
      }
      if (!session.questionIds.includes(input.questionId)) {
        throw new BadRequestException('Question is not part of this session');
      }

      const question = await tx.examQuestion.findUniqueOrThrow({ where: { id: input.questionId } });
      const options = question.options as unknown as QuestionOption[];
      if (!options.some((o) => o.id === input.selectedAnswer)) {
        throw new BadRequestException('Selected answer is not a valid option');
      }
      const isCorrect = question.correctAnswer === input.selectedAnswer;

      if (session.mode === ExamMode.EXAM) {
        await tx.examAnswer.upsert({
          where: { sessionId_questionId: { sessionId, questionId: question.id } },
          create: { sessionId, questionId: question.id, selectedAnswer: input.selectedAnswer, isCorrect },
          update: { selectedAnswer: input.selectedAnswer, isCorrect, answeredAt: new Date() },
        });
        return { saved: true }; // no correctness signal leaks during the exam
      }

      const existing = await tx.examAnswer.findUnique({
        where: { sessionId_questionId: { sessionId, questionId: question.id } },
      });
      const answer =
        existing ??
        (await tx.examAnswer.create({
          data: { sessionId, questionId: question.id, selectedAnswer: input.selectedAnswer, isCorrect },
        }));
      const source = question.sourceChunkId
        ? await tx.documentChunk.findUnique({
            where: { id: question.sourceChunkId },
            select: { content: true, chunkIndex: true },
          })
        : null;

      return {
        saved: true,
        alreadyAnswered: Boolean(existing),
        feedback: {
          selectedAnswer: answer.selectedAnswer,
          isCorrect: answer.isCorrect,
          correctAnswer: question.correctAnswer,
          explanation: question.explanation,
          sourceExcerpt: source ? { chunkIndex: source.chunkIndex, text: source.content.slice(0, 500) } : null,
        },
      };
    });
  }

  async evaluateExamSubmission(user: AuthenticatedUser, sessionId: string) {
    await this.getOwnedSessionOrThrow(user, sessionId);
    await this.finaliseSession(sessionId, ExamSessionStatus.SUBMITTED);
    return this.getExamSession(user, sessionId);
  }

  /** Printable score card for a completed attempt (owner or staff). */
  async renderScorecard(user: AuthenticatedUser, sessionId: string) {
    const session = await this.getClosedSessionOrThrow(user, sessionId);
    const [context, student, questions, answers] = await Promise.all([
      this.loadSessionContext(session),
      this.prisma.user.findUniqueOrThrow({
        where: { id: session.studentId },
        select: { email: true, fullName: true },
      }),
      this.loadQuestionsInOrder(session.questionIds),
      this.prisma.examAnswer.findMany({ where: { sessionId } }),
    ]);
    const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));
    const diagnostics = (session.diagnostics ?? {}) as {
      conceptBreakdown?: ConceptDiagnostic[];
      unansweredCount?: number;
    };
    const buffer = await renderScorecardPdf({
      candidateName: student.fullName || student.email,
      candidateEmail: student.email,
      examTitle: context.title,
      kind: session.paperId ? 'Exam program' : 'Practice',
      mode: session.mode,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      scorePercent: session.score ?? 0,
      correctCount: session.correctCount ?? 0,
      totalQuestions: session.questionIds.length,
      unansweredCount: diagnostics.unansweredCount ?? 0,
      certificateEligible: isCertificateEligible(session),
      concepts: diagnostics.conceptBreakdown ?? [],
      questions: questions.map((q, i) => {
        const a = answerByQuestion.get(q.id);
        return {
          index: i + 1,
          conceptTag: q.conceptTag,
          outcome: !a ? 'Unanswered' : a.isCorrect ? 'Correct' : 'Incorrect',
        };
      }),
    }, await this.branding.pdfBrand());
    return { buffer, filename: `${toFilenameStem(context.title)}-scorecard.pdf` };
  }

  /** Certificate PDF: only exists for exam-mode results above the threshold. */
  async renderCertificate(user: AuthenticatedUser, sessionId: string) {
    const session = await this.getClosedSessionOrThrow(user, sessionId);
    if (!isCertificateEligible(session)) {
      throw new NotFoundException(
        `A certificate requires an exam-mode score above ${CERTIFICATE_MIN_SCORE_EXCLUSIVE}%`,
      );
    }
    const [context, student] = await Promise.all([
      this.loadSessionContext(session),
      this.prisma.user.findUniqueOrThrow({
        where: { id: session.studentId },
        select: { email: true, fullName: true },
      }),
    ]);
    const buffer = await renderCertificatePdf({
      certificateId: certificateIdFor(session.id),
      candidateName: student.fullName || student.email,
      examTitle: context.title,
      scorePercent: session.score ?? 0,
      correctCount: session.correctCount ?? 0,
      totalQuestions: session.questionIds.length,
      completedAt: session.completedAt ?? session.startedAt,
    }, await this.branding.pdfBrand());
    return { buffer, filename: `${toFilenameStem(context.title)}-certificate.pdf` };
  }

  // ---------------------------------------------------------------------------

  private async finaliseSession(sessionId: string, status: ExamSessionStatus) {
    await this.prisma.$transaction(async (tx) => {
      const [session] = await tx.$queryRaw<ExamSession[]>`
        SELECT id, status, question_ids AS "questionIds", expires_at AS "expiresAt"
          FROM exam_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      if (!session) throw new NotFoundException();
      if (session.status !== ExamSessionStatus.IN_PROGRESS) {
        if (status === ExamSessionStatus.SUBMITTED) throw new ConflictException('Session already submitted');
        return;
      }
      await this.finaliseSessionInTx(tx, session, status);
    });
  }

  /** Scores the session and builds the per-concept diagnostic breakdown. */
  private async finaliseSessionInTx(
    tx: Tx,
    session: Pick<ExamSession, 'id' | 'questionIds'>,
    status: ExamSessionStatus,
  ) {
    const questions = await tx.examQuestion.findMany({
      where: { id: { in: session.questionIds } },
      select: { id: true, conceptTag: true },
    });
    const answers = await tx.examAnswer.findMany({ where: { sessionId: session.id } });
    const correctIds = new Set(answers.filter((a) => a.isCorrect).map((a) => a.questionId));

    const byConcept = new Map<string, ConceptDiagnostic>();
    for (const q of questions) {
      const entry = byConcept.get(q.conceptTag) ?? {
        conceptTag: q.conceptTag,
        totalQuestions: 0,
        correctAnswers: 0,
        accuracy: 0,
      };
      entry.totalQuestions += 1;
      if (correctIds.has(q.id)) entry.correctAnswers += 1; // unanswered counts as incorrect
      byConcept.set(q.conceptTag, entry);
    }
    const conceptBreakdown = [...byConcept.values()]
      .map((d) => ({ ...d, accuracy: Math.round((d.correctAnswers / d.totalQuestions) * 100) / 100 }))
      .sort((a, b) => a.accuracy - b.accuracy);

    const total = session.questionIds.length;
    const correctCount = correctIds.size;
    await tx.examSession.update({
      where: { id: session.id },
      data: {
        status,
        completedAt: new Date(),
        correctCount,
        score: total === 0 ? 0 : Math.round((correctCount / total) * 1000) / 10,
        diagnostics: {
          conceptBreakdown,
          weakestConcepts: conceptBreakdown
            .filter((d) => d.accuracy < WEAK_AREA_THRESHOLD)
            .map((d) => d.conceptTag),
          unansweredCount: total - answers.length,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async getClosedSessionOrThrow(user: AuthenticatedUser, sessionId: string) {
    let session = await this.getOwnedSessionOrThrow(user, sessionId);
    if (this.isExpired(session)) {
      await this.finaliseSession(sessionId, ExamSessionStatus.EXPIRED);
      session = await this.getOwnedSessionOrThrow(user, sessionId);
    }
    if (!CLOSED_STATUSES.includes(session.status)) {
      throw new ConflictException('This attempt has not been submitted yet');
    }
    return session;
  }

  private async loadSessionContext(session: Pick<ExamSession, 'materialId' | 'paperId'>) {
    if (session.paperId) {
      const paper = await this.prisma.examPaper.findUnique({
        where: { id: session.paperId },
        select: { title: true },
      });
      return { title: paper?.title ?? 'Exam program' };
    }
    const material = session.materialId
      ? await this.prisma.material.findUnique({ where: { id: session.materialId }, select: { title: true } })
      : null;
    return { title: material?.title ?? 'Deleted material' };
  }

  private buildResultView(session: ExamSession) {
    return {
      score: session.score,
      percentage: session.score,
      correctCount: session.correctCount,
      totalQuestions: session.questionIds.length,
      completedAt: session.completedAt,
      diagnostics: session.diagnostics,
      certificateEligible: isCertificateEligible(session),
    };
  }

  private async getOwnedSessionOrThrow(user: AuthenticatedUser, sessionId: string) {
    const session = await this.prisma.examSession.findUnique({ where: { id: sessionId } });
    const canRead =
      session &&
      (session.studentId === user.id || roleHasPermission(user.role, Permission.ExamResultsReadAll));
    if (!canRead) throw new NotFoundException(); // 404 hides other students' sessions
    return session;
  }

  /** Row lock serialises concurrent answer/submit requests for one session. */
  private async lockOwnedSession(tx: Tx, user: AuthenticatedUser, sessionId: string) {
    const [session] = await tx.$queryRaw<ExamSession[]>`
      SELECT id, student_id AS "studentId", mode, status, question_ids AS "questionIds",
             expires_at AS "expiresAt"
        FROM exam_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
    // Only the owning student may answer; staff read access does not grant write.
    if (!session || session.studentId !== user.id) throw new NotFoundException();
    return session;
  }

  private isExpired(session: Pick<ExamSession, 'status' | 'expiresAt'>) {
    return (
      session.status === ExamSessionStatus.IN_PROGRESS &&
      session.expiresAt !== null &&
      session.expiresAt.getTime() < Date.now()
    );
  }

  private async loadQuestionsInOrder(ids: string[]) {
    const rows = await this.prisma.examQuestion.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((q) => [q.id, q]));
    return ids.map((id) => byId.get(id)).filter((q): q is ExamQuestion => Boolean(q));
  }
}

/** Human-readable certificate id derived from the (unguessable) session id. */
export function certificateIdFor(sessionId: string): string {
  const hex = sessionId.replace(/-/g, '').toUpperCase();
  return `EDU-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export function cryptoShuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
