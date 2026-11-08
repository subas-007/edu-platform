import { ExamMode } from '@prisma/client';
import { z } from 'zod';

export const startExamSessionSchema = z
  .object({
    materialId: z.string().uuid(),
    mode: z.nativeEnum(ExamMode),
    questionCount: z.number().int().min(3).max(50).default(10),
  })
  .strict();
export type StartExamSessionInput = z.infer<typeof startExamSessionSchema>;

export const submitAnswerSchema = z
  .object({
    questionId: z.string().uuid(),
    selectedAnswer: z.enum(['A', 'B', 'C', 'D', 'E']),
  })
  .strict();
export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>;

export interface QuestionOption {
  id: string;
  text: string;
}

export interface ConceptDiagnostic {
  conceptTag: string;
  totalQuestions: number;
  correctAnswers: number;
  accuracy: number; // 0..1
}
