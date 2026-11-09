import { ExamPaperStatus } from '@prisma/client';
import { z } from 'zod';
import { sanitizedText } from '../common/validation';
import { normaliseConceptTag } from '../generation/generation.schemas';

const description = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '').trim())
  .pipe(z.string().max(2000));

/** Assemble an ad-hoc paper from APPROVED bank questions of the selected resources. */
export const createExamPaperSchema = z
  .object({
    title: sanitizedText(200),
    description: description.default(''),
    materialIds: z.array(z.string().uuid()).min(1).max(20),
    questionCount: z.number().int().min(1).max(100),
    durationMinutes: z.number().int().min(5).max(300),
    maxAttempts: z.number().int().min(1).max(5).default(1),
    conceptTags: z
      .array(sanitizedText(60).transform(normaliseConceptTag))
      .max(20)
      .optional(),
  })
  .strict();
export type CreateExamPaperInput = z.infer<typeof createExamPaperSchema>;

export const updateExamPaperSchema = z
  .object({
    title: sanitizedText(200).optional(),
    description: description.optional(),
    durationMinutes: z.number().int().min(5).max(300).optional(),
    maxAttempts: z.number().int().min(1).max(5).optional(),
    /** Full ordered replacement of the question set (DRAFT only). */
    questionIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    status: z.nativeEnum(ExamPaperStatus).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'No changes supplied');
export type UpdateExamPaperInput = z.infer<typeof updateExamPaperSchema>;

export const listExamPapersQuerySchema = z
  .object({
    status: z.nativeEnum(ExamPaperStatus).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListExamPapersQuery = z.infer<typeof listExamPapersQuerySchema>;
