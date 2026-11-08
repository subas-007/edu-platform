import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Prisma, QuestionReviewStatus, UserRole } from '@prisma/client';
import { Job } from 'bullmq';
import { LlmService } from '../ai/llm.service';
import {
  FLASHCARD_SYSTEM_PROMPT,
  formatChunksForPrompt,
  QUESTION_SYSTEM_PROMPT,
  ROADMAP_SYSTEM_PROMPT,
} from '../ai/prompts';
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
const MAX_BATCHES = 10;
const MAX_MILESTONES = 12;
const BASE_READING_WPM = 220;

interface ChunkRow {
  id: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

/** Generates flashcards, exam questions and the study roadmap for a READY material. */
@Processor(ASSET_GENERATION_QUEUE, { concurrency: 2 })
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
    if (!material) return;

    const chunks: ChunkRow[] = await this.prisma.documentChunk.findMany({
      where: { materialId: material.id },
      select: { id: true, chunkIndex: true, content: true, tokenCount: true },
      orderBy: { chunkIndex: 'asc' },
    });
    if (chunks.length === 0) return;

    // Student-private material: auto-approve for self-study. Staff/published material:
    // questions enter the examiner review queue (human-in-the-loop for high-stakes exams).
    const reviewStatus =
      material.uploadedBy.role === UserRole.STUDENT
        ? QuestionReviewStatus.APPROVED
        : QuestionReviewStatus.PENDING;

    const flashcards: Prisma.FlashcardCreateManyInput[] = [];
    const questions: Prisma.ExamQuestionCreateManyInput[] = [];

    for (const batch of this.selectRepresentativeBatches(chunks)) {
      const labelled = batch.map((c) => ({ label: `C${c.chunkIndex}`, content: c.content, id: c.id }));
      const resolveChunkId = (label: string) => labelled.find((c) => c.label === label)?.id ?? null;
      const prompt = formatChunksForPrompt(labelled);

      const [cardResult, questionResult] = await Promise.allSettled([
        this.llm.generateStructuredOutput(generatedFlashcardsSchema, FLASHCARD_SYSTEM_PROMPT, prompt),
        this.llm.generateStructuredOutput(generatedQuestionsSchema, QUESTION_SYSTEM_PROMPT, prompt),
      ]);

      if (cardResult.status === 'fulfilled') {
        for (const card of cardResult.value.flashcards) {
          flashcards.push({
            materialId: material.id,
            frontText: card.frontText,
            backText: card.backText,
            sourceChunkId: resolveChunkId(card.sourceChunk),
          });
        }
      } else this.logger.warn(`Flashcard batch failed: ${cardResult.reason}`);

      if (questionResult.status === 'fulfilled') {
        for (const q of questionResult.value.questions) {
          questions.push({
            materialId: material.id,
            questionType: q.questionType,
            questionText: q.questionText,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
            conceptTag: normaliseConceptTag(q.conceptTag) || 'general',
            sourceChunkId: resolveChunkId(q.sourceChunk),
            reviewStatus,
          });
        }
      } else this.logger.warn(`Question batch failed: ${questionResult.reason}`);
    }

    const roadmap = await this.generateStudyRoadmap(chunks, material.complexityScore ?? 0.5);

    await this.prisma.$transaction([
      this.prisma.flashcard.deleteMany({ where: { materialId: material.id } }),
      this.prisma.examQuestion.deleteMany({ where: { materialId: material.id } }),
      this.prisma.flashcard.createMany({ data: flashcards }),
      this.prisma.examQuestion.createMany({ data: questions }),
      this.prisma.studyRoadmap.upsert({
        where: { materialId: material.id },
        create: { materialId: material.id, ...roadmap },
        update: roadmap,
      }),
    ]);
    this.logger.log(
      `Material ${material.id}: ${flashcards.length} flashcards, ${questions.length} questions`,
    );
  }

  /** Evenly samples batches of adjacent chunks across the whole document. */
  private selectRepresentativeBatches(chunks: ChunkRow[]): ChunkRow[][] {
    const batches: ChunkRow[][] = [];
    for (let i = 0; i < chunks.length; i += CHUNKS_PER_BATCH) {
      batches.push(chunks.slice(i, i + CHUNKS_PER_BATCH));
    }
    if (batches.length <= MAX_BATCHES) return batches;
    const step = batches.length / MAX_BATCHES;
    return Array.from({ length: MAX_BATCHES }, (_, i) => batches[Math.floor(i * step)]);
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
      this.logger.warn(`Roadmap naming failed, using defaults: ${error}`);
    }

    const totalMinutes = milestones.reduce((s, m) => s + m.estimatedMinutes, 0);
    return {
      milestones: milestones as unknown as Prisma.InputJsonValue,
      estimatedHours: Math.round((totalMinutes / 60) * 10) / 10,
    };
  }
}
