import { UserRole } from '@prisma/client';

/**
 * Single source of truth for authorisation. Controllers declare the permission
 * they need; roles are mapped to permissions here and nowhere else.
 */
export enum Permission {
  UsersManage = 'users:manage',
  AuditLogsRead = 'audit-logs:read',
  MaterialsUpload = 'materials:upload',
  MaterialsReadAll = 'materials:read-all',
  MaterialsPublish = 'materials:publish',
  MaterialsModerate = 'materials:moderate',
  QuestionsCurate = 'questions:curate',
  ExamPapersManage = 'exam-papers:manage',
  AnalyticsRead = 'analytics:read',
  TutorUse = 'tutor:use',
  ExamsTake = 'exams:take',
  ExamResultsReadAll = 'exam-results:read-all',
  RoadmapsUse = 'roadmaps:use',
}

const ROLE_PERMISSIONS: Readonly<Record<UserRole, ReadonlySet<Permission>>> = {
  [UserRole.ADMIN]: new Set([
    Permission.UsersManage,
    Permission.AuditLogsRead,
    Permission.MaterialsUpload,
    Permission.MaterialsReadAll,
    Permission.MaterialsPublish,
    Permission.MaterialsModerate,
    Permission.QuestionsCurate,
    Permission.ExamPapersManage,
    Permission.AnalyticsRead,
    Permission.ExamResultsReadAll,
  ]),
  [UserRole.EXAMINER]: new Set([
    Permission.MaterialsUpload,
    Permission.MaterialsReadAll,
    Permission.MaterialsPublish,
    Permission.QuestionsCurate,
    Permission.ExamPapersManage,
    Permission.AnalyticsRead,
    Permission.ExamResultsReadAll,
  ]),
  [UserRole.STUDENT]: new Set([
    Permission.MaterialsUpload,
    Permission.TutorUse,
    Permission.ExamsTake,
    Permission.RoadmapsUse,
  ]),
};

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
