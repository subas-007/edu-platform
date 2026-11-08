import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const MATERIAL_LIST_SELECT = {
  id: true,
  title: true,
  fileType: true,
  status: true,
  visibility: true,
  failureReason: true,
  complexityScore: true,
  createdAt: true,
  uploadedBy: { select: { id: true, email: true, role: true } },
  _count: { select: { flashcards: true, examQuestions: true } },
} satisfies Prisma.MaterialSelect;

@Injectable()
export class StudyMaterialsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMaterialsPage(where: Prisma.MaterialWhereInput, page: number, pageSize: number) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.material.findMany({
        where,
        select: MATERIAL_LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.material.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  findMaterialSummary(id: string) {
    return this.prisma.material.findUnique({ where: { id }, select: MATERIAL_LIST_SELECT });
  }

  createMaterial(data: Prisma.MaterialUncheckedCreateInput) {
    return this.prisma.material.create({ data, select: MATERIAL_LIST_SELECT });
  }

  updateMaterial(id: string, data: Prisma.MaterialUpdateInput) {
    return this.prisma.material.update({ where: { id }, data, select: MATERIAL_LIST_SELECT });
  }

  deleteMaterial(id: string) {
    return this.prisma.material.delete({ where: { id } });
  }

  findFlashcardsForMaterial(materialId: string) {
    return this.prisma.flashcard.findMany({
      where: { materialId },
      select: { id: true, frontText: true, backText: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
