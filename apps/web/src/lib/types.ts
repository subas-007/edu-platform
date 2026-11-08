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
  correctAnswer: string;
  explanation: string;
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
  materialId: string;
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
