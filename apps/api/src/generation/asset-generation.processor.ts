import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  AiMode,
  AssetKind,
  GenerationRequestMode,
  GenerationStatus,
  MaterialGeneration,
  MaterialStatus,
  Prisma,
  QuestionReviewStatus,
  UserRole,
} from '@prisma/client';
import { Job, UnrecoverableError } from 'bullmq';
import { ChatModel, isLlmUnavailableError, LlmService } from '../ai/llm.service';
import { ModelPriorityService } from '../ai/model-priority.service';
import { ModelResolverService } from '../ai/model-resolver.service';
import { describeModelError, ModelError } from '../ai/providers/chat-model';
import {
  FLASHCARD_SYSTEM_PROMPT,
  formatChunksForPrompt,
  neutraliseTags,
  QUESTION_SYSTEM_PROMPT,
  ROADMAP_SYSTEM_PROMPT,
} from '../ai/prompts';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { ASSET_GENERATION_QUEUE, AssetGenerationJob } from '../queues/queue-names';
import {
  GeneratedFlashcards,
  generatedFlashcardsSchema,
  GeneratedQuestions,
  generatedQuestionsSchema,
  generatedRoadmapSchema,
  normaliseConceptTag,
  RoadmapMilestone,
} from './generation.schemas';
import { buildRoadmapSkeleton, isRoadmapNamed, RoadmapChunk, roadmapRecord, roadmapSectionsPrompt } from './roadmap';

const CHUNKS_PER_BATCH = 3;
/** How often a requested run checks whether the student pressed Stop (aborts the model call). */
const STOP_POLL_MS = 2_000;
const ACTIVE_STATUSES: GenerationStatus[] = [GenerationStatus.PENDING, GenerationStatus.GENERATING];
/** Existing items shown to the model per batch when asked for more, so it writes new ones. */
const AVOID_LIMIT = 25;

export const GENERATION_FAILED_MESSAGE =
  'Flashcard and question generation did not finish. Use Retry to run it again.';
const GENERATION_EMPTY_MESSAGE =
  'The AI model could not produce flashcards or questions from this material. Use Retry, or upload a clearer copy.';

const KIND_WORD: Record<AssetKind, string> = { FLASHCARDS: 'flashcards', QUESTIONS: 'questions' };
export const requestFailedMessage = (kind: AssetKind) =>
  `Generating ${KIND_WORD[kind]} did not finish. Try again, or choose the other model.`;

interface ChunkRow {
  id: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

type MaterialForGeneration = { id: string; complexityScore: number | null; uploadedBy: { role: UserRole } };

/** The student stopped the run (the API marked it CANCELLED). */
class RunStopped extends Error {
  constructor() {
    super('Stopped by the student');
  }
}

/**
 * Generates flashcards, exam questions and the study roadmap for a READY material.
 *
 * Two kinds of job share this queue:
 *  - automatic (no `kind`): after a staff upload, flashcards + questions + roadmap in one run;
 *  - requested (`kind` set): a student asked for flashcards or questions on their own upload,
 *    with the model they picked for that run, either replacing the current set or adding more.
 *
 * Model calls take seconds (hosted) to minutes (local CPU), so both are built to be
 * interrupted: every batch is saved as soon as it is produced (students see items appear),
 * progress is reported, and the finished batch indexes live in the job data so a restarted
 * or retried job resumes where it stopped.
 */
@Processor(ASSET_GENERATION_QUEUE, {
  // One run at a time: the local model serialises requests anyway, and a short
  // model queue keeps the interactive tutor responsive while generation runs.
  concurrency: 1,
  // A worker restart (deploy, watch-mode rebuild) mid-job is a stall, not a content error.
  maxStalledCount: 5,
  lockDuration: 120_000,
})
export class AssetGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(AssetGenerationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly priority: ModelPriorityService,
    private readonly models: ModelResolverService,
  ) {
    super();
  }

  async process(job: Job<AssetGenerationJob>): Promise<void> {
    if (job.data.kind) return this.processRequest(job);

    const material = await this.prisma.material.findUnique({
      where: { id: job.data.materialId },
      include: { uploadedBy: { select: { role: true } } },
    });
    if (!material || material.status !== MaterialStatus.READY) return; // deleted / re-ingesting

    // A student's own uploads use the model they chose (local, or hosted with their key);
    // staff uploads always use the server's local model.
    let model: ChatModel;
    try {
      model =
        material.uploadedBy.role === UserRole.STUDENT
          ? await this.models.forUser(material.uploadedById)
          : this.models.local;
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      await this.markFailed(material.id, `${describeModelError(error.kind, error.providerLabel ?? 'Your AI provider', error.detail)} Then use Retry.`);
      return;
    }

    try {
      await this.generateAssets(job, material, model);
    } catch (error) {
      if (error instanceof UnrecoverableError) {
        // The student's provider refused (key, credit, model): retrying would fail the same way.
        await this.markFailed(material.id, `${error.message} Then use Retry.`);
        this.logger.warn(`Generation stopped for ${material.id}: ${error.message}`);
        throw error;
      }
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isFinalAttempt) {
        await this.markFailed(material.id, GENERATION_FAILED_MESSAGE);
      }
      this.logger.error(`Generation failed for ${material.id}`, error as Error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Requested runs: one kind, the engine the student picked, REPLACE or MORE.
  // ---------------------------------------------------------------------------------------

  private async processRequest(job: Job<AssetGenerationJob>): Promise<void> {
    const { materialId } = job.data;
    const kind = job.data.kind as AssetKind;
    const [request, material] = await Promise.all([
      this.prisma.materialGeneration.findUnique({ where: { materialId_kind: { materialId, kind } } }),
      this.prisma.material.findUnique({
        where: { id: materialId },
        select: { id: true, status: true, complexityScore: true, uploadedBy: { select: { role: true } } },
      }),
    ]);
    if (!request || !material || material.status !== MaterialStatus.READY) return; // deleted meanwhile
    if (!ACTIVE_STATUSES.includes(request.status)) return; // stopped (or finished) before it started

    let model: ChatModel | null;
    try {
      model = request.engine === AiMode.HOSTED ? await this.models.hostedForUser(request.requestedById) : this.models.local;
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      await this.failRequest(materialId, kind, describeModelError(error.kind, error.providerLabel ?? 'Your AI provider', error.detail));
      return;
    }
    if (!model) {
      await this.failRequest(
        materialId,
        kind,
        'No hosted model is set up any more. Add your API key under Settings → AI model, or choose the local model.',
      );
      return;
    }

    try {
      await this.generateRequested(job, material, request, model);
    } catch (error) {
      if (error instanceof UnrecoverableError) {
        await this.failRequest(materialId, kind, error.message);
        this.logger.warn(`${KIND_WORD[kind]} for ${materialId} stopped: ${error.message}`);
        throw error;
      }
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isFinalAttempt) await this.failRequest(materialId, kind, requestFailedMessage(kind));
      this.logger.error(`Generating ${KIND_WORD[kind]} failed for ${materialId}`, error as Error);
      throw error;
    }
  }

  private async generateRequested(
    job: Job<AssetGenerationJob>,
    material: MaterialForGeneration,
    request: MaterialGeneration,
    model: ChatModel,
  ) {
    const { materialId, kind, mode } = request;
    const chunks: ChunkRow[] = await this.prisma.documentChunk.findMany({
      where: { materialId },
      select: { id: true, chunkIndex: true, content: true, tokenCount: true },
      orderBy: { chunkIndex: 'asc' },
    });
    if (chunks.length === 0) {
      await this.failRequest(materialId, kind, 'This document has no readable text to work from.');
      return;
    }
    const batches = toBatches(chunks);

    // Fixed at the first run, so a resumed job covers the same sections and knows which items are its own.
    if (!job.data.plannedBatches || !job.data.startedAt) {
      const limit = request.engine === AiMode.HOSTED ? env.GENERATION_MAX_BATCHES_HOSTED : env.GENERATION_MAX_BATCHES;
      const plannedBatches =
        mode === GenerationRequestMode.MORE
          ? await this.leastCoveredBatches(materialId, kind, batches, Math.ceil(limit / 2))
          : evenlyPick(batches.map((_, i) => i), limit);
      await job.updateData({ ...job.data, plannedBatches, startedAt: (await this.databaseNow()).toISOString(), produced: 0 });
    }
    const startedAt = new Date(job.data.startedAt!);

    // Stop: the API marks the row CANCELLED; this notices within seconds and aborts the model call.
    const stop = new AbortController();
    const watcher = setInterval(() => {
      void this.requestStillActive(materialId, kind)
        .then((active) => {
          if (!active && !stop.signal.aborted) stop.abort(new RunStopped());
        })
        .catch(() => undefined);
    }, STOP_POLL_MS);
    try {
      await this.runRequested(job, material, request, model, chunks, batches, startedAt, stop.signal);
    } catch (error) {
      if (!(error instanceof RunStopped)) throw error;
      await this.finishStopped(materialId, kind, startedAt);
    } finally {
      clearInterval(watcher);
    }
  }

  private async runRequested(
    job: Job<AssetGenerationJob>,
    material: MaterialForGeneration,
    request: MaterialGeneration,
    model: ChatModel,
    chunks: ChunkRow[],
    batches: ChunkRow[][],
    startedAt: Date,
    stop: AbortSignal,
  ) {
    const { materialId, kind, mode } = request;
    const planned = job.data.plannedBatches!;
    const completed = new Set(job.data.completedBatches ?? []);
    let produced = job.data.produced ?? 0;

    const roadmap = await this.prisma.studyRoadmap.findUnique({ where: { materialId }, select: { milestones: true } });
    const nameRoadmap = !roadmap || !isRoadmapNamed(roadmap.milestones);
    const totalSteps = planned.length + (nameRoadmap ? 1 : 0);
    let stepsDone = planned.filter((i) => completed.has(i)).length;

    const started = await this.prisma.materialGeneration.updateMany({
      where: { materialId, kind, status: { in: ACTIVE_STATUSES } },
      data: { status: GenerationStatus.GENERATING, progress: toPercent(stepsDone, totalSteps), error: null },
    });
    if (started.count === 0) throw new RunStopped();

    // REPLACE only de-duplicates within the new set; MORE also avoids everything already there.
    const existing = await this.existingItems(materialId, kind, mode === GenerationRequestMode.REPLACE ? startedAt : undefined);
    const seen = new Set(existing.map((e) => textKey(e.text)));
    const reviewStatus =
      material.uploadedBy.role === UserRole.STUDENT ? QuestionReviewStatus.APPROVED : QuestionReviewStatus.PENDING;

    for (const batchIndex of planned) {
      if (completed.has(batchIndex)) continue;
      if (!(await this.requestStillActive(materialId, kind))) throw new RunStopped();
      const labelled = batches[batchIndex].map((c) => ({ label: `C${c.chunkIndex}`, content: c.content, id: c.id }));
      const chunkIds = new Set(labelled.map((c) => c.id));
      const avoid =
        mode === GenerationRequestMode.MORE
          ? existing.filter((e) => e.sourceChunkId && chunkIds.has(e.sourceChunkId)).map((e) => e.text)
          : [];
      const prompt = formatChunksForPrompt(labelled) + avoidSection(kind, avoid);

      const result =
        kind === AssetKind.FLASHCARDS
          ? await this.callModel(
              'Flashcard',
              model,
              (signal) =>
                this.llm.generateStructuredOutput(generatedFlashcardsSchema, FLASHCARD_SYSTEM_PROMPT, prompt, { signal, model }),
              stop,
            )
          : await this.callModel(
              'Question',
              model,
              (signal) =>
                this.llm.generateStructuredOutput(generatedQuestionsSchema, QUESTION_SYSTEM_PROMPT, prompt, { signal, model }),
              stop,
            );
      if (!(await this.requestStillActive(materialId, kind))) throw new RunStopped();

      const resolveChunkId = (label: string) => labelled.find((c) => c.label === label)?.id ?? null;
      produced += await this.saveItems(materialId, kind, result, resolveChunkId, seen, reviewStatus);
      completed.add(batchIndex);
      await job.updateData({ ...job.data, completedBatches: [...completed], produced });
      await this.reportRequestProgress(materialId, kind, ++stepsDone, totalSteps);
    }

    // Student uploads get their roadmap without a model call; the first run names its sections.
    if (nameRoadmap) {
      const { milestones, groups } = buildRoadmapSkeleton(chunks, material.complexityScore ?? 0.5);
      const named = await this.nameRoadmap(milestones, groups, model, stop);
      if (stop.aborted) throw new RunStopped();
      if (named || !roadmap) {
        await this.prisma.studyRoadmap.upsert({
          where: { materialId },
          create: { materialId, ...roadmapRecord(milestones) },
          update: roadmapRecord(milestones),
        });
      }
    }

    const added = await this.countItems(materialId, kind, { gte: startedAt });
    if (!(await this.requestStillActive(materialId, kind))) throw new RunStopped();
    if (added === 0 && produced === 0) {
      await this.failRequest(
        materialId,
        kind,
        `The model did not produce any ${KIND_WORD[kind]} from this document. Try again, or choose the other model.`,
      );
      return;
    }
    // One step, so a Stop pressed at the last moment either wins (nothing removed) or comes too late.
    const finished = await this.prisma.$transaction(async (tx) => {
      const done = await tx.materialGeneration.updateMany({
        where: { materialId, kind, status: { in: ACTIVE_STATUSES } },
        data: { status: GenerationStatus.COMPLETED, progress: 100, error: null, added },
      });
      if (done.count > 0 && mode === GenerationRequestMode.REPLACE && added > 0) {
        await this.removeOlderItems(tx, materialId, kind, startedAt);
      }
      return done.count > 0;
    });
    if (!finished) throw new RunStopped();
    this.logger.log(`Material ${materialId}: ${mode} ${KIND_WORD[kind]} with ${model.providerLabel}/${model.model}: ${added} added`);
  }

  /** Saves new items, dropping ones that repeat an existing item. Returns how many the model wrote. */
  private async saveItems(
    materialId: string,
    kind: AssetKind,
    result: GeneratedFlashcards | GeneratedQuestions | null,
    resolveChunkId: (label: string) => string | null,
    seen: Set<string>,
    reviewStatus: QuestionReviewStatus,
  ): Promise<number> {
    const isNew = (text: string) => {
      const key = textKey(text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    };
    if (kind === AssetKind.FLASHCARDS) {
      const cards = (result as GeneratedFlashcards | null)?.flashcards ?? [];
      await this.prisma.flashcard.createMany({
        data: cards
          .filter((c) => isNew(c.frontText))
          .map((c) => ({ materialId, frontText: c.frontText, backText: c.backText, sourceChunkId: resolveChunkId(c.sourceChunk) })),
      });
      return cards.length;
    }
    const questions = (result as GeneratedQuestions | null)?.questions ?? [];
    await this.prisma.examQuestion.createMany({
      data: questions
        .filter((q) => isNew(q.questionText))
        .map((q) => ({
          materialId,
          questionType: q.questionType,
          questionText: q.questionText,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          conceptTag: normaliseConceptTag(q.conceptTag) || 'general',
          sourceChunkId: resolveChunkId(q.sourceChunk),
          reviewStatus,
        })),
    });
    return questions.length;
  }

  private async existingItems(materialId: string, kind: AssetKind, since?: Date) {
    const createdAt = since ? { gte: since } : undefined;
    if (kind === AssetKind.FLASHCARDS) {
      const rows = await this.prisma.flashcard.findMany({
        where: { materialId, createdAt },
        select: { frontText: true, sourceChunkId: true },
      });
      return rows.map((r) => ({ text: r.frontText, sourceChunkId: r.sourceChunkId }));
    }
    const rows = await this.prisma.examQuestion.findMany({
      where: { materialId, createdAt },
      select: { questionText: true, sourceChunkId: true },
    });
    return rows.map((r) => ({ text: r.questionText, sourceChunkId: r.sourceChunkId }));
  }

  private countItems(materialId: string, kind: AssetKind, createdAt: { gte: Date }) {
    return kind === AssetKind.FLASHCARDS
      ? this.prisma.flashcard.count({ where: { materialId, createdAt } })
      : this.prisma.examQuestion.count({ where: { materialId, createdAt } });
  }

  /** The sections with the fewest items of this kind so far, spread across the document. */
  private async leastCoveredBatches(materialId: string, kind: AssetKind, batches: ChunkRow[][], limit: number) {
    const counts =
      kind === AssetKind.FLASHCARDS
        ? await this.prisma.flashcard.groupBy({ by: ['sourceChunkId'], where: { materialId }, _count: { _all: true } })
        : await this.prisma.examQuestion.groupBy({ by: ['sourceChunkId'], where: { materialId }, _count: { _all: true } });
    const perChunk = new Map(counts.map((c) => [c.sourceChunkId, c._count._all]));
    const coverage = batches.map((batch) => batch.reduce((sum, c) => sum + (perChunk.get(c.id) ?? 0), 0));

    const levels = [...new Set(coverage)].sort((a, b) => a - b);
    const picked: number[] = [];
    for (const level of levels) {
      if (picked.length >= limit) break;
      const atLevel = coverage.flatMap((c, i) => (c === level ? [i] : []));
      picked.push(...evenlyPick(atLevel, limit - picked.length));
    }
    return picked.sort((a, b) => a - b);
  }

  /** Regenerate: the earlier set goes once the new one exists. Questions already answered or in a paper stay. */
  private async removeOlderItems(tx: Prisma.TransactionClient, materialId: string, kind: AssetKind, before: Date) {
    if (kind === AssetKind.FLASHCARDS) {
      await tx.flashcard.deleteMany({ where: { materialId, createdAt: { lt: before } } });
      return;
    }
    await tx.$executeRaw`
      DELETE FROM exam_questions q
       WHERE q.material_id = ${materialId}::uuid
         AND q.created_at < ${before}
         AND NOT EXISTS (SELECT 1 FROM exam_answers a WHERE a.question_id = q.id)
         AND NOT EXISTS (SELECT 1 FROM exam_papers p WHERE q.id = ANY(p.question_ids))
         AND NOT EXISTS (SELECT 1 FROM exam_sessions s WHERE q.id = ANY(s.question_ids))`;
  }

  /** Item timestamps come from the database clock, so compare against that, not this process's. */
  private async databaseNow(): Promise<Date> {
    const [row] = await this.prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
    return row.now;
  }

  /** False once the student stopped the run (or the material was deleted). */
  private async requestStillActive(materialId: string, kind: AssetKind) {
    const count = await this.prisma.materialGeneration.count({
      where: { materialId, kind, status: { in: ACTIVE_STATUSES } },
    });
    return count > 0;
  }

  /** Keeps what was made before Stop (nothing is removed) and records how many that was. */
  private async finishStopped(materialId: string, kind: AssetKind, startedAt: Date) {
    const added = await this.countItems(materialId, kind, { gte: startedAt });
    await this.prisma.materialGeneration.updateMany({
      where: { materialId, kind, status: GenerationStatus.CANCELLED },
      data: { added },
    });
    this.logger.log(`Material ${materialId}: ${KIND_WORD[kind]} run stopped (${added} kept)`);
  }

  private reportRequestProgress(materialId: string, kind: AssetKind, stepsDone: number, totalSteps: number) {
    return this.prisma.materialGeneration.updateMany({
      where: { materialId, kind },
      data: { progress: toPercent(stepsDone, totalSteps) },
    });
  }

  /** Only a run still in progress can fail; a stopped one stays stopped. */
  private failRequest(materialId: string, kind: AssetKind, message: string) {
    return this.prisma.materialGeneration.updateMany({
      where: { materialId, kind, status: { in: ACTIVE_STATUSES } },
      data: { status: GenerationStatus.FAILED, error: message },
    });
  }

  // ---------------------------------------------------------------------------------------
  // Automatic run after a staff upload: flashcards + questions per batch, then the roadmap.
  // ---------------------------------------------------------------------------------------

  private async generateAssets(job: Job<AssetGenerationJob>, material: MaterialForGeneration, model: ChatModel) {
    const chunks: ChunkRow[] = await this.prisma.documentChunk.findMany({
      where: { materialId: material.id },
      select: { id: true, chunkIndex: true, content: true, tokenCount: true },
      orderBy: { chunkIndex: 'asc' },
    });
    if (chunks.length === 0) {
      await this.markFailed(material.id, GENERATION_EMPTY_MESSAGE);
      return;
    }

    // Student-private material: auto-approve for self-study. Staff/published material:
    // questions enter the examiner review queue (human-in-the-loop for high-stakes exams).
    const reviewStatus =
      material.uploadedBy.role === UserRole.STUDENT
        ? QuestionReviewStatus.APPROVED
        : QuestionReviewStatus.PENDING;

    // Fixed for the life of the job, so resumed batch indexes keep meaning the same sections
    // even if the student switches model meanwhile.
    const batchLimit =
      job.data.batchLimit ??
      (model.kind === 'hosted' ? env.GENERATION_MAX_BATCHES_HOSTED : env.GENERATION_MAX_BATCHES);
    if (job.data.batchLimit === undefined) await job.updateData({ ...job.data, batchLimit });
    const batches = selectRepresentativeBatches(chunks, batchLimit);
    const completed = new Set(job.data.completedBatches ?? []);
    const totalSteps = batches.length * 2 + 1; // flashcards + questions per batch, then roadmap
    let stepsDone = completed.size * 2;

    if (completed.size === 0) await this.clearUnusedAssets(material.id); // fresh (re)generation
    await this.prisma.material.update({
      where: { id: material.id },
      data: {
        generationStatus: GenerationStatus.GENERATING,
        generationProgress: toPercent(stepsDone, totalSteps),
        generationError: null,
      },
    });

    for (const [batchIndex, batch] of batches.entries()) {
      if (completed.has(batchIndex)) continue;
      // Each model call can take minutes: stop early if the material was deleted meanwhile,
      // so the (single) generation slot is freed for the next upload.
      if (!(await this.materialStillExists(material.id))) return this.logAbandoned(material.id);
      const labelled = batch.map((c) => ({ label: `C${c.chunkIndex}`, content: c.content, id: c.id }));
      const resolveChunkId = (label: string) => labelled.find((c) => c.label === label)?.id ?? null;
      const prompt = formatChunksForPrompt(labelled);

      // Sequential on purpose (see concurrency note above).
      const cards = await this.callModel('Flashcard', model, (signal) =>
        this.llm.generateStructuredOutput(generatedFlashcardsSchema, FLASHCARD_SYSTEM_PROMPT, prompt, { signal, model }),
      );
      if (!(await this.materialStillExists(material.id))) return this.logAbandoned(material.id);
      await this.reportProgress(material.id, ++stepsDone, totalSteps);
      const questions = await this.callModel('Question', model, (signal) =>
        this.llm.generateStructuredOutput(generatedQuestionsSchema, QUESTION_SYSTEM_PROMPT, prompt, { signal, model }),
      );
      if (!(await this.materialStillExists(material.id))) return this.logAbandoned(material.id);

      await this.prisma.$transaction([
        this.prisma.flashcard.createMany({
          data: (cards?.flashcards ?? []).map((card) => ({
            materialId: material.id,
            frontText: card.frontText,
            backText: card.backText,
            sourceChunkId: resolveChunkId(card.sourceChunk),
          })),
        }),
        this.prisma.examQuestion.createMany({
          data: (questions?.questions ?? []).map((q) => ({
            materialId: material.id,
            questionType: q.questionType,
            questionText: q.questionText,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
            conceptTag: normaliseConceptTag(q.conceptTag) || 'general',
            sourceChunkId: resolveChunkId(q.sourceChunk),
            reviewStatus,
          })),
        }),
      ]);
      completed.add(batchIndex);
      await job.updateData({ ...job.data, completedBatches: [...completed] });
      await this.reportProgress(material.id, ++stepsDone, totalSteps);
    }

    if (!(await this.materialStillExists(material.id))) return this.logAbandoned(material.id);
    const { milestones, groups } = buildRoadmapSkeleton(chunks, material.complexityScore ?? 0.5);
    await this.nameRoadmap(milestones, groups, model);
    const roadmap = roadmapRecord(milestones);
    const [cardCount, questionCount] = await Promise.all([
      this.prisma.flashcard.count({ where: { materialId: material.id } }),
      this.prisma.examQuestion.count({ where: { materialId: material.id } }),
    ]);
    const producedNothing = cardCount === 0 && questionCount === 0;

    await this.prisma.$transaction([
      this.prisma.studyRoadmap.upsert({
        where: { materialId: material.id },
        create: { materialId: material.id, ...roadmap },
        update: roadmap,
      }),
      this.prisma.material.update({
        where: { id: material.id },
        data: producedNothing
          ? { generationStatus: GenerationStatus.FAILED, generationProgress: 0, generationError: GENERATION_EMPTY_MESSAGE }
          : { generationStatus: GenerationStatus.COMPLETED, generationProgress: 100, generationError: null },
      }),
    ]);
    this.logger.log(`Material ${material.id}: ${cardCount} flashcards, ${questionCount} questions`);
  }

  // ---------------------------------------------------------------------------------------
  // Shared
  // ---------------------------------------------------------------------------------------

  /**
   * A malformed model answer only loses that batch; an unreachable/timed-out model fails
   * the job so BullMQ retries it later (resuming from the persisted batches). On the local
   * model the call steps aside (and is repeated) whenever a student is waiting for the tutor.
   * A hosted provider rejecting the key, credit or model stops the job with that reason.
   */
  private async callModel<T>(
    label: string,
    model: ChatModel,
    call: (signal: AbortSignal) => Promise<T>,
    stop?: AbortSignal,
  ): Promise<T | null> {
    try {
      return model.kind === 'local'
        ? await this.priority.runPreemptible(`${label} generation`, (signal) => call(withStop(signal, stop)))
        : await call(stop ?? new AbortController().signal);
    } catch (error) {
      if (stop?.aborted) throw new RunStopped();
      if (model.kind === 'hosted' && error instanceof ModelError && ['auth', 'quota', 'model'].includes(error.kind)) {
        throw new UnrecoverableError(describeModelError(error.kind, model.providerLabel, error.detail));
      }
      if (isLlmUnavailableError(error)) throw error;
      this.logger.warn(`${label} batch failed: ${error}`);
      return null;
    }
  }

  /**
   * Time estimates are deterministic (token count × complexity); the model only names and
   * summarises the sections, so a bad answer cannot skew the schedule. Edits `milestones`
   * in place and returns whether the model named them.
   */
  private async nameRoadmap(
    milestones: RoadmapMilestone[],
    groups: RoadmapChunk[][],
    model: ChatModel,
    stop?: AbortSignal,
  ): Promise<boolean> {
    try {
      const sections = roadmapSectionsPrompt(groups);
      const nameSections = (signal: AbortSignal) =>
        this.llm.generateStructuredOutput(generatedRoadmapSchema, ROADMAP_SYSTEM_PROMPT, sections, {
          signal: withStop(signal, stop),
          model,
        });
      const named =
        model.kind === 'local'
          ? await this.priority.runPreemptible('Roadmap generation', nameSections)
          : await nameSections(new AbortController().signal);
      for (const m of named.milestones) {
        const target = milestones[m.section - 1];
        if (target) Object.assign(target, { title: m.title, summary: m.summary });
      }
      return true;
    } catch (error) {
      // The schedule is still useful with provisional section names.
      this.logger.warn(`Roadmap naming failed, keeping provisional names: ${error}`);
      return false;
    }
  }

  private async materialStillExists(materialId: string) {
    return (await this.prisma.material.count({ where: { id: materialId } })) > 0;
  }

  private logAbandoned(materialId: string) {
    this.logger.log(`Material ${materialId} was deleted; generation stopped`);
  }

  /** updateMany: a material deleted during a model call is not an error (the loop then stops). */
  private reportProgress(materialId: string, stepsDone: number, totalSteps: number) {
    return this.prisma.material.updateMany({
      where: { id: materialId },
      data: { generationProgress: toPercent(stepsDone, totalSteps) },
    });
  }

  private markFailed(materialId: string, message: string) {
    return this.prisma.material.updateMany({
      where: { id: materialId },
      data: { generationStatus: GenerationStatus.FAILED, generationError: message },
    });
  }

  /** Removes earlier generated assets, keeping questions students already answered or that papers use. */
  private async clearUnusedAssets(materialId: string) {
    await this.prisma.$transaction([
      this.prisma.flashcard.deleteMany({ where: { materialId } }),
      this.prisma.$executeRaw`
        DELETE FROM exam_questions q
         WHERE q.material_id = ${materialId}::uuid
           AND NOT EXISTS (SELECT 1 FROM exam_answers a WHERE a.question_id = q.id)
           AND NOT EXISTS (SELECT 1 FROM exam_papers p WHERE q.id = ANY(p.question_ids))
           AND NOT EXISTS (SELECT 1 FROM exam_sessions s WHERE q.id = ANY(s.question_ids))`,
    ]);
  }
}

/** The call is cancelled by either signal: the tutor taking the model, or the student's Stop. */
function withStop(signal: AbortSignal, stop?: AbortSignal): AbortSignal {
  return stop ? AbortSignal.any([signal, stop]) : signal;
}

/** Adjacent chunks, CHUNKS_PER_BATCH at a time, in document order. */
function toBatches<T>(chunks: T[]): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < chunks.length; i += CHUNKS_PER_BATCH) batches.push(chunks.slice(i, i + CHUNKS_PER_BATCH));
  return batches;
}

/** Evenly samples batches of adjacent chunks across the whole document (deterministic). */
export function selectRepresentativeBatches<T>(chunks: T[], maxBatches: number): T[][] {
  return evenlyPick(toBatches(chunks), maxBatches);
}

/** Up to `n` items spread evenly across the list (deterministic, keeps order). */
export function evenlyPick<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]);
}

/** Two items with the same key say the same thing (case, spacing and punctuation ignored). */
function textKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 300);
}

/** Tells the model what the student already has, so "more" means new points, not rephrasings. */
function avoidSection(kind: AssetKind, texts: string[]): string {
  if (texts.length === 0) return '';
  const lines = texts
    .slice(0, AVOID_LIMIT)
    .map((t) => `- ${neutraliseTags(t).replace(/\s+/g, ' ').slice(0, 160)}`)
    .join('\n');
  return `\n\nThe student already has these ${KIND_WORD[kind]} for this material. Write new ones about other points; do not repeat or rephrase these:\n${lines}`;
}

/** Never reports 100 before the final write. */
function toPercent(done: number, total: number) {
  return Math.min(99, Math.floor((done / Math.max(1, total)) * 100));
}
