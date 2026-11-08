import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ExamMode,
  ExamQuestion,
  ExamSession,
  ExamSessionStatus,
  Prisma,
  QuestionReviewStatus,
} from '@prisma/client';
import { randomInt } from 'node:crypto';
import { AuthenticatedUser } from '../common/decorators/access.decorators';
import { Permission, roleHasPermission } from '../common/security/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { MaterialAccessPolicy } from '../study-materials/material-access.policy';
import {
  ConceptDiagnostic,
  QuestionOption,
  StartExamSessionInput,
  SubmitAnswerInput,
} from './exam-sessions.schemas';

const SECONDS_PER_QUESTION = 90;
const WEAK_AREA_THRESHOLD = 0.7;

type Tx = Prisma.TransactionClient;

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

    return {
      id: session.id,
      materialId: session.materialId,
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
              ? { isCorrect: answer.isCorrect, correctAnswer: q.correctAnswer, explanation: q.explanation }
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

  private buildResultView(session: ExamSession) {
    return {
      score: session.score,
      percentage: session.score,
      correctCount: session.correctCount,
      totalQuestions: session.questionIds.length,
      completedAt: session.completedAt,
      diagnostics: session.diagnostics,
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
    // Only the owning student may answer — staff read access does not grant write.
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

function cryptoShuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
