import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import {
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { Permission } from '../common/security/permissions';
import { uuidParam } from '../common/validation';
import { RoadmapMilestone } from '../generation/generation.schemas';
import { PrismaService } from '../prisma/prisma.service';
import { MaterialAccessPolicy } from '../study-materials/material-access.policy';

const updateProgressSchema = z
  .object({ milestoneId: z.string().regex(/^m\d{1,3}$/), completed: z.boolean() })
  .strict();
type UpdateProgressInput = z.infer<typeof updateProgressSchema>;

@Injectable()
export class StudyRoadmapsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicy: MaterialAccessPolicy,
  ) {}

  async getStudentRoadmap(user: AuthenticatedUser, materialId: string) {
    await this.accessPolicy.getReadableMaterialOrThrow(user, materialId);
    const roadmap = await this.prisma.studyRoadmap.findUnique({
      where: { materialId },
      include: { progress: { where: { studentId: user.id } } },
    });
    if (!roadmap) throw new NotFoundException('Roadmap is still being generated');

    const milestones = roadmap.milestones as unknown as RoadmapMilestone[];
    const completed = new Set(roadmap.progress[0]?.completedMilestones ?? []);
    const remainingMinutes = milestones
      .filter((m) => !completed.has(m.id))
      .reduce((sum, m) => sum + m.estimatedMinutes, 0);

    return {
      materialId,
      estimatedHours: roadmap.estimatedHours,
      remainingMinutes,
      completionRatio: milestones.length ? completed.size / milestones.length : 0,
      // Students may skip straight to exams at any time — the roadmap is advisory.
      canTakeExamNow: true,
      milestones: milestones.map((m) => ({ ...m, completed: completed.has(m.id) })),
    };
  }

  async updateMilestoneProgress(user: AuthenticatedUser, materialId: string, input: UpdateProgressInput) {
    await this.accessPolicy.getReadableMaterialOrThrow(user, materialId);
    const roadmap = await this.prisma.studyRoadmap.findUnique({ where: { materialId } });
    if (!roadmap) throw new NotFoundException();
    const milestones = roadmap.milestones as unknown as RoadmapMilestone[];
    if (!milestones.some((m) => m.id === input.milestoneId)) {
      throw new BadRequestException('Unknown milestone');
    }

    const key = { studentId_roadmapId: { studentId: user.id, roadmapId: roadmap.id } };
    const existing = await this.prisma.roadmapProgress.findUnique({ where: key });
    const completed = new Set(existing?.completedMilestones ?? []);
    if (input.completed) completed.add(input.milestoneId);
    else completed.delete(input.milestoneId);

    await this.prisma.roadmapProgress.upsert({
      where: key,
      create: { studentId: user.id, roadmapId: roadmap.id, completedMilestones: [...completed] },
      update: { completedMilestones: [...completed] },
    });
    return this.getStudentRoadmap(user, materialId);
  }
}

@Controller('study-roadmaps')
@RequirePermissions(Permission.RoadmapsUse)
export class StudyRoadmapsController {
  constructor(private readonly roadmaps: StudyRoadmapsService) {}

  @Get(':materialId')
  getStudentRoadmap(@CurrentUser() user: AuthenticatedUser, @Param('materialId', uuidParam) id: string) {
    return this.roadmaps.getStudentRoadmap(user, id);
  }

  @Put(':materialId/progress')
  updateMilestoneProgress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('materialId', uuidParam) id: string,
    @Body(zodBody(updateProgressSchema)) body: UpdateProgressInput,
  ) {
    return this.roadmaps.updateMilestoneProgress(user, id, body);
  }
}

@Module({ controllers: [StudyRoadmapsController], providers: [StudyRoadmapsService] })
export class StudyRoadmapsModule {}
