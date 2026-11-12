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

/** CANCELLED: a flashcard / question run the student stopped (never set on a material itself). */
export type GenerationStatus = 'PENDING' | 'GENERATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface StudyMaterial {
  id: string;
  title: string;
  fileType: 'URL' | 'PDF' | 'JPEG' | 'PNG' | 'DOCX';
  status: MaterialStatus;
  visibility: 'PRIVATE' | 'PUBLISHED';
  failureReason: string | null;
  complexityScore: number | null;
  reusedFromId: string | null;
  /** Flashcard/question/roadmap generation, which runs after status becomes READY. */
  generationStatus: GenerationStatus;
  generationProgress: number;
  generationError: string | null;
  createdAt: string;
  uploadedBy: { id: string; email: string; role: UserRole };
  _count: { flashcards: number; examQuestions: number };
  /** Flashcard / question runs the uploader asked for (latest per kind). */
  generations?: MaterialGeneration[];
}

export type AssetKind = 'FLASHCARDS' | 'QUESTIONS';
export type GenerationEngine = 'LOCAL' | 'HOSTED';
export type GenerationRequestMode = 'REPLACE' | 'MORE';

export interface MaterialGeneration {
  kind: AssetKind;
  /** PENDING = queued, GENERATING = running. */
  status: GenerationStatus;
  progress: number;
  error: string | null;
  engine: GenerationEngine;
  engineLabel: string;
  mode: GenerationRequestMode;
  /** New items saved by the finished run. */
  added: number | null;
  updatedAt: string;
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

/** GET /me/ai-settings: which model answers this student (the API key itself is never returned). */
export interface AiSettings {
  mode: 'LOCAL' | 'HOSTED';
  provider: string | null;
  model: string | null;
  /** e.g. "…a1b2" when a key is saved. */
  keyHint: string | null;
  /** False when the server has no LLM_CREDENTIALS_KEY: only the local model is offered. */
  hostedAvailable: boolean;
  local: { label: string };
  providers: Array<{
    id: string;
    label: string;
    keysUrl: string;
    suggestedModels: Array<{ id: string; note: string }>;
  }>;
}

export interface AiSettingsSaved {
  settings: AiSettings;
  test: { ok: boolean; latencyMs: number } | null;
}

/** Events from POST /tutor/queries/stream, in the order they usually arrive. */
export type TutorStreamEvent =
  | { type: 'engine'; kind: 'local' | 'hosted'; provider: string; model: string }
  | { type: 'stage'; stage: 'searching' | 'selecting' | 'waiting' }
  | { type: 'sources'; citations: TutorAnswer['citations'] }
  | { type: 'stage'; stage: 'reading'; promptTokens: number; estimatedSeconds: number }
  | { type: 'stage'; stage: 'writing'; readSeconds: number }
  | { type: 'text'; text: string }
  | ({ type: 'done'; seconds: number } & TutorAnswer)
  | { type: 'error'; status: number; message: string };

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
