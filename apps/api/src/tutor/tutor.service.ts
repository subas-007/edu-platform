import { Injectable } from '@nestjs/common';
import { MaterialStatus } from '@prisma/client';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';
import { LlmService } from '../ai/llm.service';
import { neutraliseTags, OUT_OF_SCOPE_ANSWER, TUTOR_SYSTEM_PROMPT } from '../ai/prompts';
import { AuthenticatedUser } from '../common/decorators/access.decorators';
import { sanitizedText } from '../common/validation';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { MaterialAccessPolicy } from '../study-materials/material-access.policy';
import { TutorRetrievalRepository } from './tutor-retrieval.repository';

const TOP_K = 6;
/** Below this cosine similarity a chunk is considered irrelevant (TUTOR_MIN_SIMILARITY). */
const MIN_SIMILARITY = env.TUTOR_MIN_SIMILARITY;

export const tutorQuerySchema = z
  .object({
    question: sanitizedText(2000),
    materialIds: z.array(z.string().uuid()).min(1).max(20).optional(),
    history: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: sanitizedText(4000) }).strict())
      .max(6)
      .default([]),
  })
  .strict();
export type TutorQueryInput = z.infer<typeof tutorQuerySchema>;

@Injectable()
export class TutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicy: MaterialAccessPolicy,
    private readonly retrieval: TutorRetrievalRepository,
    private readonly llm: LlmService,
  ) {}

  async answerStudentQuestion(user: AuthenticatedUser, input: TutorQueryInput) {
    // Authorisation BEFORE retrieval: intersect requested ids with readable, ready materials.
    const readable = await this.prisma.material.findMany({
      where: {
        AND: [
          this.accessPolicy.buildReadableMaterialsFilter(user),
          { status: MaterialStatus.READY },
          input.materialIds ? { id: { in: input.materialIds } } : {},
        ],
      },
      select: { id: true },
      take: 200,
    });
    if (readable.length === 0) return { answer: OUT_OF_SCOPE_ANSWER, citations: [], grounded: false };

    const queryEmbedding = await this.llm.embedText(input.question);
    const chunks = (
      await this.retrieval.findSimilarChunks(queryEmbedding, readable.map((m) => m.id), TOP_K)
    ).filter((c) => Number(c.similarity) >= MIN_SIMILARITY);

    // Short-circuit: no relevant context → refuse without calling the LLM (zero hallucination surface).
    if (chunks.length === 0) return { answer: OUT_OF_SCOPE_ANSWER, citations: [], grounded: false };

    const context = chunks
      .map(
        (c, i) =>
          `<source id="S${i + 1}" material="${neutraliseTags(c.materialTitle).replace(/"/g, "'")}">\n${neutraliseTags(c.content)}\n</source>`,
      )
      .join('\n\n');

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: TUTOR_SYSTEM_PROMPT },
      ...input.history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: 'user', content: `Course sources:\n${context}\n\nStudent question: ${input.question}` },
    ];
    const answer = await this.llm.generateChatCompletion(messages);

    return {
      answer: answer || OUT_OF_SCOPE_ANSWER,
      grounded: answer.trim() !== OUT_OF_SCOPE_ANSWER,
      citations: chunks.map((c, i) => ({
        sourceId: `S${i + 1}`,
        materialId: c.materialId,
        materialTitle: c.materialTitle,
        chunkIndex: c.chunkIndex,
        excerpt: c.content.slice(0, 280),
        similarity: Math.round(Number(c.similarity) * 1000) / 1000,
      })),
    };
  }
}
