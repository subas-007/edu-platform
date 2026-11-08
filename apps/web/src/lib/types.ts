import type { UserRole } from './roles';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SessionUser {
  id: string;
  email: string;
  fullName?: string | null;
  role: UserRole;
}

export interface ManagedUser extends SessionUser {
  isActive: boolean;
  createdAt: string;
}

export type MaterialStatus = 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';

export interface StudyMaterial {
  id: string;
  title: string;
  fileType: 'URL' | 'PDF' | 'JPEG' | 'PNG' | 'DOCX';
  status: MaterialStatus;
  visibility: 'PRIVATE' | 'PUBLISHED';
  failureReason: string | null;
  complexityScore: number | null;
  reusedFromId: string | null;
  createdAt: string;
  uploadedBy: { id: string; email: string; role: UserRole };
  _count: { flashcards: number; examQuestions: number };
}

export interface Flashcard {
  id: string;
  frontText: string;
  backText: string;
}

export interface QuestionOption {
  id: string;
  text: string;
}

export interface AnswerFeedback {
  selectedAnswer?: string;
  isCorrect: boolean;
  /** Omitted for exam-program attempts (the answer key is never revealed). */
  correctAnswer?: string;
  explanation?: string;
  sourceExcerpt?: { chunkIndex: number; text: string } | null;
}

export interface ConceptDiagnostic {
  conceptTag: string;
  totalQuestions: number;
  correctAnswers: number;
  accuracy: number;
}

export interface ExamSessionView {
  id: string;
  kind: 'PRACTICE' | 'PROGRAM';
  title: string;
  materialId: string | null;
  paperId: string | null;
  mode: 'LEARNING' | 'EXAM';
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED';
  startedAt: string;
  expiresAt: string | null;
  serverTime: string;
  questions: Array<{
    id: string;
    questionType: 'MULTIPLE_CHOICE' | 'SCENARIO';
    questionText: string;
    options: QuestionOption[];
    selectedAnswer: string | null;
    feedback: AnswerFeedback | null;
  }>;
  result: null | {
    score: number;
    percentage: number;
    correctCount: number;
    totalQuestions: number;
    completedAt: string;
    certificateEligible: boolean;
    diagnostics: {
      conceptBreakdown: ConceptDiagnostic[];
      weakestConcepts: string[];
      unansweredCount: number;
    };
  };
}

export interface RoadmapView {
  materialId: string;
  estimatedHours: number;
  remainingMinutes: number;
  completionRatio: number;
  canTakeExamNow: boolean;
  milestones: Array<{
    id: string;
    title: string;
    summary: string;
    estimatedMinutes: number;
    completed: boolean;
  }>;
}

export interface TutorAnswer {
  answer: string;
  grounded: boolean;
  citations: Array<{
    sourceId: string;
    materialId: string;
    materialTitle: string;
    chunkIndex: number;
    excerpt: string;
    similarity: number;
  }>;
}

export interface AttemptSummary {
  id: string;
  kind: 'PRACTICE' | 'PROGRAM';
  title: string;
  materialId: string | null;
  paperId: string | null;
  mode: 'LEARNING' | 'EXAM';
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED';
  score: number | null;
  correctCount: number | null;
  totalQuestions: number;
  startedAt: string;
  completedAt: string | null;
  certificateEligible: boolean;
}

export type ExamPaperStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED';

export interface StudentProgram {
  id: string;
  title: string;
  description: string;
  status: ExamPaperStatus;
  durationMinutes: number;
  maxAttempts: number;
  questionCount: number;
  publishedAt: string | null;
  enrolled: boolean;
  enrolledAt: string | null;
  attemptsUsed: number;
  activeSessionId: string | null;
  bestScore: number | null;
  bestSessionId: string | null;
  certificateSessionId: string | null;
}

export interface ExamPaperSummary {
  id: string;
  title: string;
  description: string;
  status: ExamPaperStatus;
  durationMinutes: number;
  maxAttempts: number;
  questionCount: number;
  resourceCount: number;
  createdBy: { email: string; fullName: string | null };
  createdAt: string;
  publishedAt: string | null;
  enrollmentCount: number;
  attemptCount: number;
  completedAttemptCount: number;
  averageScore: number | null;
}

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface BankQuestion {
  id: string;
  questionType: 'MULTIPLE_CHOICE' | 'SCENARIO';
  questionText: string;
  options: QuestionOption[];
  correctAnswer: string;
  explanation: string;
  conceptTag: string;
  reviewStatus: ReviewStatus;
  material: { id?: string; title: string };
}

export interface ExamPaperDetail {
  id: string;
  title: string;
  description: string;
  status: ExamPaperStatus;
  durationMinutes: number;
  maxAttempts: number;
  createdBy: { email: string; fullName: string | null };
  createdAt: string;
  publishedAt: string | null;
  requestedQuestionCount?: number;
  materials: Array<{ id: string; title: string }>;
  questions: BankQuestion[];
  stats: {
    enrollmentCount: number;
    attemptCount: number;
    completedAttemptCount: number;
    averageScore: number | null;
    certificatesIssued: number;
  };
  candidates: Array<{
    studentId: string;
    email: string;
    fullName: string | null;
    enrolledAt: string;
    attempts: number;
    bestScore: number | null;
    certified: boolean;
  }>;
}

export interface BankResource {
  id: string;
  title: string;
  fileType: StudyMaterial['fileType'];
  visibility: StudyMaterial['visibility'];
  createdAt: string;
  reusedFromId: string | null;
  counts: { approved: number; pending: number; rejected: number; total: number };
  concepts: Array<{ conceptTag: string; approved: number }>;
}

export interface NotificationItem {
  id: string;
  kind: 'material-ready' | 'material-failed' | 'new-program' | 'certificate' | 'review-queue';
  title: string;
  body: string;
  href: string;
  createdAt: string;
}
