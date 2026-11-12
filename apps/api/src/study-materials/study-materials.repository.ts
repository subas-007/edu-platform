import { Injectable } from '@nestjs/common';
import { AssetKind, GenerationStatus, Prisma, QuestionReviewStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const MATERIAL_LIST_SELECT = {
  id: true,
  title: true,
  fileType: true,
  status: true,
  visibility: true,
  failureReason: true,
  complexityScore: true,
  reusedFromId: true,
  generationStatus: true,
  generationProgress: true,
  generationError: true,
  createdAt: true,
  uploadedBy: { select: { id: true, email: true, role: true } },
  _count: { select: { flashcards: true, examQuestions: true } },
  /** Flashcard / question runs the uploader asked for (latest per kind). */
  generations: {
    select: {
      kind: true,
      status: true,
      progress: true,
      error: true,
      engine: true,
      engineLabel: true,
      mode: true,
      added: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.MaterialSelect;

/** Students only ever see APPROVED questions, so their counts must match what they can use. */
export const STUDENT_MATERIAL_LIST_SELECT = {
  ...MATERIAL_LIST_SELECT,
  _count: {
    select: {
      flashcards: true,
      examQuestions: { where: { reviewStatus: QuestionReviewStatus.APPROVED } },
    },
  },
} satisfies Prisma.MaterialSelect;

@Injectable()
export class StudyMaterialsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMaterialsPage(
    where: Prisma.MaterialWhereInput,
    page: number,
    pageSize: number,
    approvedCountsOnly = false,
  ) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.material.findMany({
        where,
        select: approvedCountsOnly ? STUDENT_MATERIAL_LIST_SELECT : MATERIAL_LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.material.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  findMaterialSummary(id: string, approvedCountsOnly = false) {
    return this.prisma.material.findUnique({
      where: { id },
      select: approvedCountsOnly ? STUDENT_MATERIAL_LIST_SELECT : MATERIAL_LIST_SELECT,
    });
  }

  createMaterial(data: Prisma.MaterialUncheckedCreateInput) {
    return this.prisma.material.create({ data, select: MATERIAL_LIST_SELECT });
  }

  updateMaterial(id: string, data: Prisma.MaterialUpdateInput) {
    return this.prisma.material.update({ where: { id }, data, select: MATERIAL_LIST_SELECT });
  }

  findGeneration(materialId: string, kind: AssetKind) {
    return this.prisma.materialGeneration.findUnique({ where: { materialId_kind: { materialId, kind } } });
  }

  upsertGeneration(
    materialId: string,
    kind: AssetKind,
    data: Omit<Prisma.MaterialGenerationUncheckedCreateInput, 'materialId' | 'kind'>,
  ) {
    return this.prisma.materialGeneration.upsert({
      where: { materialId_kind: { materialId, kind } },
      create: { materialId, kind, ...data },
      update: data,
    });
  }

  /** Marks a queued or running run as stopped. Returns false when none was in progress. */
  async stopGeneration(materialId: string, kind: AssetKind) {
    const { count } = await this.prisma.materialGeneration.updateMany({
      where: { materialId, kind, status: { in: [GenerationStatus.PENDING, GenerationStatus.GENERATING] } },
      data: { status: GenerationStatus.CANCELLED },
    });
    return count > 0;
  }

  /** For a run stopped before a worker picked it up again: how many items it had already made. */
  async recordStoppedCount(materialId: string, kind: AssetKind, since?: string) {
    const createdAt = since ? { gte: new Date(since) } : undefined;
    const added = !createdAt
      ? 0
      : kind === AssetKind.FLASHCARDS
        ? await this.prisma.flashcard.count({ where: { materialId, createdAt } })
        : await this.prisma.examQuestion.count({ where: { materialId, createdAt } });
    await this.prisma.materialGeneration.updateMany({
      where: { materialId, kind, status: GenerationStatus.CANCELLED },
      data: { added },
    });
  }

  deleteMaterial(id: string) {
    return this.prisma.material.delete({ where: { id } });
  }

  findFlashcardsForMaterial(materialId: string) {
    return this.prisma.flashcard.findMany({
      where: { materialId },
      select: { id: true, frontText: true, backText: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], // stable while new batches are appended
    });
  }
}
