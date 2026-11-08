import { Controller, Get, Injectable, Module } from '@nestjs/common';
import {
  ExamMode,
  ExamPaperStatus,
  ExamSessionStatus,
  MaterialStatus,
  QuestionReviewStatus,
} from '@prisma/client';
import {
  AuthenticatedOnly,
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/access.decorators';
import { Permission, roleHasPermission } from '../common/security/permissions';
import { CERTIFICATE_MIN_SCORE_EXCLUSIVE } from '../exam-sessions/exam-sessions.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 24 * 3600 * 1000;

export interface NotificationItem {
  /** Stable id: changes when the underlying event changes, so read-state can be tracked client-side. */
  id: string;
  kind: 'material-ready' | 'material-failed' | 'new-program' | 'certificate' | 'review-queue';
  title: string;
  body: string;
  href: string;
  createdAt: Date;
}

/**
 * Derived notification feed: computed from existing records on request, so there is
 * no extra table to keep in sync. Read/unread state is kept in the browser.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listNotifications(user: AuthenticatedUser): Promise<NotificationItem[]> {
    const since = new Date(Date.now() - 14 * DAY);
    const items: NotificationItem[] = [];
    const isStudent = roleHasPermission(user.role, Permission.ExamsTake);
    const base = isStudent ? '/student' : user.role === 'ADMIN' ? '/admin' : '/examiner';

    const materials = await this.prisma.material.findMany({
      where: {
        uploadedById: user.id,
        status: { in: [MaterialStatus.READY, MaterialStatus.FAILED] },
        updatedAt: { gte: since },
      },
      select: { id: true, title: true, status: true, updatedAt: true, reusedFromId: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    for (const m of materials) {
      const ready = m.status === MaterialStatus.READY;
      items.push({
        id: `material-${m.id}-${m.status}`,
        kind: ready ? 'material-ready' : 'material-failed',
        title: ready ? `"${m.title}" is ready` : `"${m.title}" could not be processed`,
        body: ready
          ? m.reusedFromId
            ? 'Matched an existing document; its flashcards and questions were reused instantly.'
            : 'Flashcards, practice questions and a study roadmap are being prepared.'
          : 'Open the material list for details and try uploading again.',
        href: ready && isStudent ? `/student/materials/${m.id}` : `${base}/materials`,
        createdAt: m.updatedAt,
      });
    }

    if (isStudent) {
      const programs = await this.prisma.examPaper.findMany({
        where: {
          status: ExamPaperStatus.PUBLISHED,
          publishedAt: { gte: new Date(Date.now() - 30 * DAY) },
          enrollments: { none: { studentId: user.id } },
        },
        select: { id: true, title: true, publishedAt: true },
        orderBy: { publishedAt: 'desc' },
        take: 5,
      });
      for (const p of programs) {
        items.push({
          id: `program-${p.id}`,
          kind: 'new-program',
          title: `New exam program: ${p.title}`,
          body: 'Enroll to take this exam.',
          href: '/student/programs',
          createdAt: p.publishedAt ?? new Date(),
        });
      }

      const certificates = await this.prisma.examSession.findMany({
        where: {
          studentId: user.id,
          mode: ExamMode.EXAM,
          status: { in: [ExamSessionStatus.SUBMITTED, ExamSessionStatus.EXPIRED] },
          score: { gt: CERTIFICATE_MIN_SCORE_EXCLUSIVE },
          completedAt: { gte: new Date(Date.now() - 30 * DAY) },
        },
        include: { material: { select: { title: true } }, paper: { select: { title: true } } },
        orderBy: { completedAt: 'desc' },
        take: 5,
      });
      for (const s of certificates) {
        items.push({
          id: `certificate-${s.id}`,
          kind: 'certificate',
          title: `Certificate earned: ${s.paper?.title ?? s.material?.title ?? 'exam'}`,
          body: `You scored ${s.score}%. Download it from Results & certificates.`,
          href: '/student/history',
          createdAt: s.completedAt ?? s.startedAt,
        });
      }
    }

    if (roleHasPermission(user.role, Permission.QuestionsCurate)) {
      const pending = await this.prisma.examQuestion.aggregate({
        where: { reviewStatus: QuestionReviewStatus.PENDING },
        _count: { _all: true },
        _max: { createdAt: true },
      });
      if (pending._count._all > 0) {
        items.push({
          id: `review-${pending._count._all}-${pending._max.createdAt?.getTime()}`,
          kind: 'review-queue',
          title: `${pending._count._all} question${pending._count._all === 1 ? '' : 's'} awaiting review`,
          body: 'Approve questions to make them available for practice and exam programs.',
          href: `${base}/question-bank`,
          createdAt: pending._max.createdAt ?? new Date(),
        });
      }
    }

    return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 20);
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @AuthenticatedOnly()
  @Get()
  listNotifications(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listNotifications(user);
  }
}

@Module({ controllers: [NotificationsController], providers: [NotificationsService] })
export class NotificationsModule {}
