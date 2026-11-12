import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { GenerationStatus, MaterialFileType, MaterialStatus, UserRole } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { LlmService, toVectorLiteral } from '../ai/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ASSET_GENERATION_QUEUE,
  AssetGenerationJob,
  enqueueUniqueJob,
  generationJobId,
  MATERIAL_INGESTION_QUEUE,
  MaterialIngestionJob,
} from '../queues/queue-names';
import { buildRoadmapSkeleton, roadmapRecord } from '../generation/roadmap';
import { MaterialStorageService } from '../study-materials/material-storage.service';
import { computeContentHash, MaterialReuseService } from './material-reuse.service';
import { SourceRejectedError, UnsafeUrlError } from './parsers/safe-url-fetcher';
import {
  extractTextFromDocx,
  extractTextFromImage,
  extractTextFromPdf,
  extractTextFromUrl,
  normaliseExtractedText,
} from './parsers/text-extractors';
import { chunkTextForEmbedding, estimateTextComplexity } from './text-chunker';

const MIN_USEFUL_CHARS = 200;

/**
 * Parse → normalise → chunk → embed → store, off the HTTP thread.
 *
 * Student uploads stop here: the document is stored and indexed (the tutor can use it, and
 * it gets a study roadmap without a model call). Flashcards and questions are generated
 * only when the student asks for them, with the model they pick. Staff uploads go on to
 * the automatic generation run (their questions feed the examiner review queue).
 */
@Processor(MATERIAL_INGESTION_QUEUE, { concurrency: 2, maxStalledCount: 5, lockDuration: 120_000 })
export class MaterialIngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(MaterialIngestionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MaterialStorageService,
    private readonly llm: LlmService,
    private readonly reuse: MaterialReuseService,
    @InjectQueue(ASSET_GENERATION_QUEUE)
    private readonly generationQueue: Queue<AssetGenerationJob>,
  ) {
    super();
  }

  async process(job: Job<MaterialIngestionJob>): Promise<void> {
    const { materialId } = job.data;
    const material = await this.prisma.material.findUnique({
      where: { id: materialId },
      include: { uploadedBy: { select: { role: true } } },
    });
    if (!material) return; // deleted while queued
    const onDemand = material.uploadedBy.role === UserRole.STUDENT;

    await this.prisma.material.update({
      where: { id: materialId },
      data: {
        status: MaterialStatus.PROCESSING,
        failureReason: null,
        generationStatus: GenerationStatus.PENDING,
        generationProgress: 0,
        generationError: null,
      },
    });

    try {
      const text = normaliseExtractedText(await this.extractMaterialText(material));
      if (text.length < MIN_USEFUL_CHARS) {
        throw new UserFacingIngestionError('Not enough readable text was found in this material');
      }

      // Identical content already analysed? Copy its assets instead of re-embedding/re-generating.
      const contentHash = computeContentHash(text);
      await this.prisma.material.update({ where: { id: materialId }, data: { contentHash } });
      if (await this.reuse.tryReuseExistingAnalysis(materialId, contentHash)) return;

      const chunks = chunkTextForEmbedding(text);
      const embeddings = await this.llm.embedTexts(chunks.map((c) => c.content));
      const complexityScore = estimateTextComplexity(text);

      await this.prisma.$transaction(async (tx) => {
        await tx.documentChunk.deleteMany({ where: { materialId } }); // idempotent retries
        for (const [i, chunk] of chunks.entries()) {
          await tx.$executeRaw`
            INSERT INTO document_chunks (id, material_id, chunk_index, content, token_count, embedding)
            VALUES (${randomUUID()}::uuid, ${materialId}::uuid, ${chunk.chunkIndex},
                    ${chunk.content}, ${chunk.tokenCount}, ${toVectorLiteral(embeddings[i])}::vector)`;
        }
        if (onDemand) {
          // Nothing runs automatically; "COMPLETED" = no automatic generation pending.
          const roadmap = roadmapRecord(buildRoadmapSkeleton(chunks, complexityScore).milestones);
          await tx.studyRoadmap.upsert({ where: { materialId }, create: { materialId, ...roadmap }, update: roadmap });
        }
        await tx.material.update({
          where: { id: materialId },
          data: {
            status: MaterialStatus.READY,
            complexityScore,
            ...(onDemand ? { generationStatus: GenerationStatus.COMPLETED, generationProgress: 100 } : {}),
          },
        });
      }, { timeout: 120_000 });

      if (!onDemand) {
        await enqueueUniqueJob(this.generationQueue, 'generate-assets', { materialId }, generationJobId(materialId));
      }
      this.logger.log(`Ingested material ${materialId}: ${chunks.length} chunks${onDemand ? ' (stored; generation on request)' : ''}`);
    } catch (error) {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const permanent =
        error instanceof UserFacingIngestionError ||
        error instanceof UnsafeUrlError ||
        error instanceof SourceRejectedError;
      if (isFinalAttempt || permanent) {
        await this.prisma.material.update({
          where: { id: materialId },
          data: {
            status: MaterialStatus.FAILED,
            // Only curated messages reach users; raw errors stay in server logs.
            failureReason: permanent ? (error as Error).message : 'Processing failed. Please retry.',
          },
        });
      }
      this.logger.error(`Ingestion failed for ${materialId}`, error as Error);
      if (permanent) job.discard();
      throw error;
    }
  }

  private async extractMaterialText(material: { fileType: MaterialFileType; fileUrl: string }) {
    if (material.fileType === MaterialFileType.URL) return extractTextFromUrl(material.fileUrl);
    const file = await this.storage.readMaterialFile(material.fileUrl);
    switch (material.fileType) {
      case MaterialFileType.PDF:
        return extractTextFromPdf(file);
      case MaterialFileType.DOCX:
        return extractTextFromDocx(file);
      case MaterialFileType.PNG:
      case MaterialFileType.JPEG:
        return extractTextFromImage(file);
    }
  }
}

class UserFacingIngestionError extends Error {}
