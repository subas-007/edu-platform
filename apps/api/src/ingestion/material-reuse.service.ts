import { Injectable, Logger } from '@nestjs/common';
import {
  MaterialStatus,
  MaterialVisibility,
  Prisma,
  QuestionReviewStatus,
  UserRole,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Stable fingerprint of a material's text. Hashes a canonical form (Unicode NFKC,
 * lower-case, all whitespace removed) so the same document still matches when a
 * parser or format lays out line breaks and spacing differently.
 */
export function computeContentHash(text: string): string {
  const canonical = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Re-uploads of a document that was already analysed reuse its chunks/embeddings,
 * flashcards, question bank entries and roadmap instead of calling the LLM again.
 *
 * Access rules (so dedup can never become a side channel):
 *  - a student may only reuse analysis from material they can already read
 *    (their own uploads or PUBLISHED material), and only receives APPROVED questions
 *    from someone else's material;
 *  - staff may reuse anything, but questions that came from a student's private upload
 *    re-enter the examiner review queue as PENDING.
 */
@Injectable()
export class MaterialReuseService {
  private readonly logger = new Logger(MaterialReuseService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Returns the source material id when reuse happened, otherwise null. */
  async tryReuseExistingAnalysis(targetId: string, contentHash: string): Promise<string | null> {
    const target = await this.prisma.material.findUnique({
      where: { id: targetId },
      select: { id: true, uploadedBy: { select: { id: true, role: true } } },
    });
    if (!target) return null;
    const uploader = target.uploadedBy;
    const uploaderIsStudent = uploader.role === UserRole.STUDENT;

    const source = await this.prisma.material.findFirst({
      where: {
        contentHash,
        id: { not: targetId },
        status: MaterialStatus.READY,
        roadmap: { isNot: null }, // roadmap is written last → generation finished
        ...(uploaderIsStudent
          ? { OR: [{ visibility: MaterialVisibility.PUBLISHED }, { uploadedById: uploader.id }] }
          : {}),
      },
      select: {
        id: true,
        uploadedById: true,
        complexityScore: true,
        uploadedBy: { select: { role: true } },
        roadmap: { select: { milestones: true, estimatedHours: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!source?.roadmap) return null;

    const sourceIsOwn = source.uploadedById === uploader.id;
    const sourceIsStudent = source.uploadedBy.role === UserRole.STUDENT;
    const mapReviewStatus = (status: QuestionReviewStatus): QuestionReviewStatus | null => {
      if (uploaderIsStudent) {
        if (sourceIsOwn) return status;
        return status === QuestionReviewStatus.APPROVED ? QuestionReviewStatus.APPROVED : null;
      }
      return sourceIsStudent ? QuestionReviewStatus.PENDING : status;
    };

    const roadmap = source.roadmap;
    await this.prisma.$transaction(
      async (tx) => {
        await tx.documentChunk.deleteMany({ where: { materialId: targetId } });
        // Embeddings are copied in SQL so the vectors never round-trip through Node.
        await tx.$executeRaw`
          INSERT INTO document_chunks (id, material_id, chunk_index, content, token_count, embedding)
          SELECT gen_random_uuid(), ${targetId}::uuid, chunk_index, content, token_count, embedding
            FROM document_chunks WHERE material_id = ${source.id}::uuid`;

        const [sourceChunks, targetChunks] = await Promise.all([
          tx.documentChunk.findMany({ where: { materialId: source.id }, select: { id: true, chunkIndex: true } }),
          tx.documentChunk.findMany({ where: { materialId: targetId }, select: { id: true, chunkIndex: true } }),
        ]);
        const targetByIndex = new Map(targetChunks.map((c) => [c.chunkIndex, c.id]));
        const chunkIdMap = new Map(sourceChunks.map((c) => [c.id, targetByIndex.get(c.chunkIndex) ?? null]));
        const remapChunk = (id: string | null) => (id ? (chunkIdMap.get(id) ?? null) : null);

        const [flashcards, questions] = await Promise.all([
          tx.flashcard.findMany({ where: { materialId: source.id } }),
          tx.examQuestion.findMany({ where: { materialId: source.id } }),
        ]);

        await tx.flashcard.deleteMany({ where: { materialId: targetId } });
        await tx.examQuestion.deleteMany({ where: { materialId: targetId } });
        await tx.flashcard.createMany({
          data: flashcards.map((f) => ({
            materialId: targetId,
            frontText: f.frontText,
            backText: f.backText,
            sourceChunkId: remapChunk(f.sourceChunkId),
          })),
        });
        await tx.examQuestion.createMany({
          data: questions.flatMap((q) => {
            const reviewStatus = mapReviewStatus(q.reviewStatus);
            if (!reviewStatus) return [];
            return [
              {
                materialId: targetId,
                questionType: q.questionType,
                questionText: q.questionText,
                options: q.options as Prisma.InputJsonValue,
                correctAnswer: q.correctAnswer,
                explanation: q.explanation,
                conceptTag: q.conceptTag,
                sourceChunkId: remapChunk(q.sourceChunkId),
                reviewStatus,
              },
            ];
          }),
        });
        await tx.studyRoadmap.upsert({
          where: { materialId: targetId },
          create: {
            materialId: targetId,
            milestones: roadmap.milestones as Prisma.InputJsonValue,
            estimatedHours: roadmap.estimatedHours,
          },
          update: {
            milestones: roadmap.milestones as Prisma.InputJsonValue,
            estimatedHours: roadmap.estimatedHours,
          },
        });
        await tx.material.update({
          where: { id: targetId },
          data: {
            status: MaterialStatus.READY,
            complexityScore: source.complexityScore,
            reusedFromId: source.id,
          },
        });
      },
      { timeout: 120_000 },
    );

    this.logger.log(`Material ${targetId}: reused analysis of ${source.id} (no LLM calls)`);
    return source.id;
  }
}
