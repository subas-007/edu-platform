import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  GenerationStatus,
  MaterialStatus,
  Prisma,
  QuestionReviewStatus,
  UserRole,
} from '@prisma/client';
import { Job } from 'bullmq';
import { isLlmUnavailableError, LlmService } from '../ai/llm.service';
import {
  FLASHCARD_SYSTEM_PROMPT,
  formatChunksForPrompt,
  QUESTION_SYSTEM_PROMPT,
  ROADMAP_SYSTEM_PROMPT,
} from '../ai/prompts';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { ASSET_GENERATION_QUEUE, AssetGenerationJob } from '../queues/queue-names';
import {
  generatedFlashcardsSchema,
  generatedQuestionsSchema,
  generatedRoadmapSchema,
  normaliseConceptTag,
  RoadmapMilestone,
} from './generation.schemas';

const CHUNKS_PER_BATCH = 3;
const MAX_MILESTONES = 12;
const BASE_READING_WPM = 220;

export const GENERATION_FAILED_MESSAGE =
  'Flashcard and question generation did not finish. Use Retry to run it again.';
const GENERATION_EMPTY_MESSAGE =
  'The AI model could not produce flashcards or questions from this material. Use Retry, or upload a clearer copy.';

interface ChunkRow {
  id: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

/**
 * Generates flashcards, exam questions and the study roadmap for a READY material.
 *
 * Local CPU inference makes this slow (minutes per batch), so it is built to be
 * interrupted: every batch is persisted as soon as it is produced (students see cards
 * appear progressively), progress is reported on the material, and the completed batch
 * indexes live in the job data so a restarted or retried job resumes where it stopped.
 */
@Processor(ASSET_GENERATION_QUEUE, {
  // One material at a time: the local model serialises requests anyway, and a short
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
  ) {
    super();
  }

  async process(job: Job<AssetGenerationJob>): Promise<void> {
    const material = await this.prisma.material.findUnique({
      where: { id: job.data.materialId },
      include: { uploadedBy: { select: { role: true } } },
    });
    if (!material || material.status !== MaterialStatus.READY) return; // deleted / re-ingesting

    try {
      await this.generateAssets(job, material);
    } catch (error) {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isFinalAttempt) {
        await this.markFailed(material.id, GENERATION_FAILED_MESSAGE);
      }
      this.logger.error(`Generation failed for ${material.id}`, error as Error);
      throw error;
    }
  }

  private async generateAssets(
    job: Job<AssetGenerationJob>,
    material: { id: string; complexityScore: number | null; uploadedBy: { role: UserRole } },
  ) {
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

    const batches = selectRepresentativeBatches(chunks, env.GENERATION_MAX_BATCHES);
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
      const labelled = batch.map((c) => ({ label: `C${c.chunkIndex}`, content: c.content, id: c.id }));
      const resolveChunkId = (label: string) => labelled.find((c) => c.label === label)?.id ?? null;
      const prompt = formatChunksForPrompt(labelled);

      // Sequential on purpose (see concurrency note above).
      const cards = await this.callModel('Flashcard', () =>
        this.llm.generateStructuredOutput(generatedFlashcardsSchema, FLASHCARD_SYSTEM_PROMPT, prompt),
      );
      await this.reportProgress(material.id, ++stepsDone, totalSteps);
      const questions = await this.callModel('Question', () =>
        this.llm.generateStructuredOutput(generatedQuestionsSchema, QUESTION_SYSTEM_PROMPT, prompt),
      );

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

    const roadmap = await this.generateStudyRoadmap(chunks, material.complexityScore ?? 0.5);
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

  /**
   * A malformed model answer only loses that batch; an unreachable/timed-out model fails
   * the job so BullMQ retries it later (resuming from the persisted batches).
   */
  private async callModel<T>(label: string, call: () => Promise<T>): Promise<T | null> {
    try {
      return await call();
    } catch (error) {
      if (isLlmUnavailableError(error)) throw error;
      this.logger.warn(`${label} batch failed: ${error}`);
      return null;
    }
  }

  private reportProgress(materialId: string, stepsDone: number, totalSteps: number) {
    return this.prisma.material.update({
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

  /**
   * Time estimates are deterministic (token count × complexity); the LLM only
   * names/summarises milestones, so a bad model response cannot skew the schedule.
   */
  private async generateStudyRoadmap(chunks: ChunkRow[], complexity: number) {
    const groupSize = Math.max(1, Math.ceil(chunks.length / MAX_MILESTONES));
    const groups: ChunkRow[][] = [];
    for (let i = 0; i < chunks.length; i += groupSize) groups.push(chunks.slice(i, i + groupSize));

    const effectiveWpm = BASE_READING_WPM * (1 - 0.45 * complexity);
    const milestones: RoadmapMilestone[] = groups.map((group, i) => {
      const words = group.reduce((sum, c) => sum + c.tokenCount * 0.75, 0);
      const readingMinutes = words / effectiveWpm;
      return {
        id: `m${i + 1}`,
        title: `Section ${i + 1}`,
        summary: '',
        estimatedMinutes: Math.max(5, Math.round(readingMinutes * 1.5 + 5)), // + review/practice
        chunkIndexes: group.map((c) => c.chunkIndex),
      };
    });

    try {
      const sections = groups
        .map((g, i) => `<chunk label="S${i + 1}">\n${g[0].content.slice(0, 600)}\n</chunk>`)
        .join('\n\n');
      const named = await this.llm.generateStructuredOutput(
        generatedRoadmapSchema,
        ROADMAP_SYSTEM_PROMPT,
        sections,
      );
      for (const m of named.milestones) {
        const target = milestones[m.section - 1];
        if (target) Object.assign(target, { title: m.title, summary: m.summary });
      }
    } catch (error) {
      // The schedule is still useful with generic section names.
      this.logger.warn(`Roadmap naming failed, using defaults: ${error}`);
    }

    const totalMinutes = milestones.reduce((s, m) => s + m.estimatedMinutes, 0);
    return {
      milestones: milestones as unknown as Prisma.InputJsonValue,
      estimatedHours: Math.round((totalMinutes / 60) * 10) / 10,
    };
  }
}

/** Evenly samples batches of adjacent chunks across the whole document (deterministic). */
export function selectRepresentativeBatches<T>(chunks: T[], maxBatches: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < chunks.length; i += CHUNKS_PER_BATCH) {
    batches.push(chunks.slice(i, i + CHUNKS_PER_BATCH));
  }
  if (batches.length <= maxBatches) return batches;
  const step = batches.length / maxBatches;
  return Array.from({ length: maxBatches }, (_, i) => batches[Math.floor(i * step)]);
}

/** Never reports 100 before the final write. */
function toPercent(done: number, total: number) {
  return Math.min(99, Math.floor((done / total) * 100));
}
