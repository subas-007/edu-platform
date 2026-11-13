import { z } from 'zod';

const chunkLabel = z.string().regex(/^C\d+$/);
const optionId = z.enum(['A', 'B', 'C', 'D', 'E']);

export const generatedFlashcardsSchema = z.object({
  flashcards: z
    .array(
      z.object({
        frontText: z.string().trim().min(3).max(300),
        backText: z.string().trim().min(1).max(800),
        sourceChunk: chunkLabel,
      }),
    )
    .max(10),
});

export const generatedQuestionsSchema = z.object({
  questions: z
    .array(
      z
        .object({
          questionType: z.enum(['MULTIPLE_CHOICE', 'SCENARIO']),
          questionText: z.string().trim().min(10).max(1500),
          options: z
            .array(z.object({ id: optionId, text: z.string().trim().min(1).max(500) }))
            .min(3)
            .max(5),
          correctAnswer: optionId,
          explanation: z.string().trim().min(10).max(2000),
          conceptTag: z.string().trim().min(2).max(60),
          sourceChunk: chunkLabel,
        })
        .refine(
          (q) =>
            new Set(q.options.map((o) => o.id)).size === q.options.length &&
            q.options.some((o) => o.id === q.correctAnswer),
          'correctAnswer must reference exactly one unique option',
        ),
    )
    .max(8),
});

export type GeneratedFlashcards = z.infer<typeof generatedFlashcardsSchema>;
export type GeneratedQuestions = z.infer<typeof generatedQuestionsSchema>;

export const generatedRoadmapSchema = z.object({
  milestones: z.array(
    z.object({
      section: z.number().int().min(1),
      title: z.string().trim().min(1).max(120),
      summary: z.string().trim().max(400),
    }),
  ),
});

export interface RoadmapMilestone {
  id: string;
  title: string;
  summary: string;
  estimatedMinutes: number;
  chunkIndexes: number[];
}

export const normaliseConceptTag = (tag: string) =>
  tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
