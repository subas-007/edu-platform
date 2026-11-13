import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MaterialStatus } from '@prisma/client';
import { z } from 'zod';
import { ChatMessage, ChatModel, isLlmUnavailableError, LlmService } from '../ai/llm.service';
import { ModelPriorityService } from '../ai/model-priority.service';
import { ModelResolverService } from '../ai/model-resolver.service';
import { describeModelError, ModelError } from '../ai/providers/chat-model';
import { neutraliseTags, OUT_OF_SCOPE_ANSWER, TUTOR_SYSTEM_PROMPT } from '../ai/prompts';
import { AuthenticatedUser } from '../common/decorators/access.decorators';
import { sanitizedText } from '../common/validation';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { MaterialAccessPolicy } from '../study-materials/material-access.policy';
import { compressPassages, estimateTokens } from './context-compressor';
import { RetrievedChunk, TutorRetrievalRepository } from './tutor-retrieval.repository';

/** Passages retrieved per question (TUTOR_TOP_K). With TUTOR_CONTEXT_TOKENS only their best sentences are sent. */
const TOP_K = env.TUTOR_TOP_K;
/** Below this cosine similarity a chunk is considered irrelevant (TUTOR_MIN_SIMILARITY). */
const MIN_SIMILARITY = env.TUTOR_MIN_SIMILARITY;
/** A model used this recently is still warm: no warm-up needed. */
const WARM_FOR_MS = 3 * 60_000;
/** Earlier answers are cut to this length when re-sent: the model re-reads all history every turn. */
const HISTORY_MESSAGE_MAX_CHARS = 800;
export const TUTOR_BUSY_MESSAGE =
  'The AI model is busy or not running right now (it may be generating study material). Please try again in a minute.';
export const TUTOR_TIMEOUT_MESSAGE =
  'The tutor took too long to answer. Try a shorter question, or select fewer documents, and ask again.';

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

export interface TutorCitation {
  sourceId: string;
  materialId: string;
  materialTitle: string;
  chunkIndex: number;
  excerpt: string;
  similarity: number;
}

export interface TutorAnswer {
  answer: string;
  grounded: boolean;
  citations: TutorCitation[];
}

/**
 * What the tutor is doing, streamed to the student while they wait. On a CPU model the
 * `reading` stage (the model processing the prompt) is most of the wait, so it carries an
 * estimate the UI turns into a progress bar.
 */
export type TutorEvent =
  | { type: 'engine'; kind: 'local' | 'hosted'; provider: string; model: string }
  | { type: 'stage'; stage: 'searching' | 'selecting' }
  | { type: 'sources'; citations: TutorCitation[] }
  | { type: 'stage'; stage: 'waiting' } // a background generation call is giving the model up
  | { type: 'stage'; stage: 'reading'; promptTokens: number; estimatedSeconds: number }
  | { type: 'stage'; stage: 'writing'; readSeconds: number }
  | { type: 'text'; text: string }
  | ({ type: 'done'; seconds: number } & TutorAnswer);

/** The model sometimes quotes the refusal sentence or drops its full stop. */
const normaliseRefusal = (text: string) => text.replace(/["“”]/g, '').replace(/[.\s]+$/, '').trim();

/** Hosted models read a prompt in a second or two; this is only the first estimate. */
const HOSTED_READ_TOKENS_PER_SEC = 1_000;
/** Hosted models are fast enough to re-read more of the conversation. */
const HOSTED_HISTORY_MESSAGES = 6;

/** Exponential moving average of how fast a model reads prompts (tokens/s), per API process. */
class ReadSpeed {
  constructor(private value: number) {}

  get tokensPerSecond() {
    return this.value;
  }

  record(promptTokens: number, seconds: number) {
    if (promptTokens < 50 || seconds < 0.5) return; // too small to measure
    this.value = this.value * 0.5 + (promptTokens / seconds) * 0.5;
  }
}

@Injectable()
export class TutorService {
  private readonly logger = new Logger(TutorService.name);
  /** Per provider/model: the local model and each hosted model read at very different speeds. */
  private readonly readSpeeds = new Map<string, ReadSpeed>();
  private answersInFlight = 0;
  /** When this process last sent the model work (answers or warm-ups). */
  private lastModelUse = 0;
  /** A real question cancels a warm-up still running: what it loaded so far stays loaded. */
  private warmUpInFlight?: AbortController;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicy: MaterialAccessPolicy,
    private readonly retrieval: TutorRetrievalRepository,
    private readonly llm: LlmService,
    private readonly priority: ModelPriorityService,
    private readonly models: ModelResolverService,
  ) {}

  /**
   * Called when a student opens the tutor. A local model left idle is unloaded or paged out,
   * and the first question then pays to load it back. A tiny request while the student is
   * still typing loads it in advance. Skipped for students on a hosted model, when the model
   * is busy anyway (warm), or when it was used recently.
   */
  async warmUp(user: AuthenticatedUser): Promise<{ started: boolean }> {
    if (this.answersInFlight > 0 || Date.now() - this.lastModelUse < WARM_FOR_MS) return { started: false };
    const model = await this.models.forUser(user.id).catch(() => this.models.local);
    if (model.kind !== 'local') return { started: false };
    if (await this.priority.backgroundBusy()) return { started: false };
    this.lastModelUse = Date.now();
    const started = Date.now();
    const warmUp = new AbortController();
    this.warmUpInFlight = warmUp;
    void this.llm
      .generateChatCompletion(
        [
          { role: 'system', content: TUTOR_SYSTEM_PROMPT },
          { role: 'user', content: 'Course sources: (none yet)\n\nStudent question: Are you ready to help me study?' },
        ],
        1,
        { timeoutMs: env.TUTOR_TIMEOUT_MS, maxRetries: 0, signal: warmUp.signal },
      )
      .then(() => this.logger.log(`Model warmed up in ${Math.round((Date.now() - started) / 1000)} s`))
      .catch((error) => {
        if (!warmUp.signal.aborted) this.logger.warn(`Model warm-up failed: ${error}`);
      })
      .finally(() => {
        if (this.warmUpInFlight === warmUp) this.warmUpInFlight = undefined;
      });
    return { started: true };
  }

  /** Non-streaming form (JSON API): runs the same pipeline and returns the final answer. */
  async answerStudentQuestion(user: AuthenticatedUser, input: TutorQueryInput): Promise<TutorAnswer> {
    const controller = new AbortController();
    for await (const event of this.streamStudentAnswer(user, input, controller.signal)) {
      if (event.type === 'done') return { answer: event.answer, grounded: event.grounded, citations: event.citations };
    }
    throw new Error('Tutor answer stream ended without an answer');
  }

  /**
   * Answers from the student's readable materials only, reporting each stage as it happens.
   * Aborting `signal` (the student pressed Stop or left) cancels the model request.
   */
  async *streamStudentAnswer(
    user: AuthenticatedUser,
    input: TutorQueryInput,
    signal: AbortSignal,
  ): AsyncGenerator<TutorEvent> {
    const started = Date.now();
    const finish = (answer: TutorAnswer): TutorEvent => ({
      type: 'done',
      seconds: Math.round((Date.now() - started) / 100) / 10,
      ...answer,
    });
    const outOfScope = finish({ answer: OUT_OF_SCOPE_ANSWER, citations: [], grounded: false });

    const model = await this.resolveModel(user);
    const local = model.kind === 'local';
    // Claim the local model now, so a background generation call starts stepping aside while
    // retrieval runs (the model server needs a few seconds to stop). A hosted model is the
    // student's own and shares nothing with background work.
    const release = local ? await this.priority.claim() : async () => undefined;
    this.answersInFlight++;
    if (local) this.warmUpInFlight?.abort();
    try {
      yield { type: 'engine', kind: model.kind, provider: model.providerLabel, model: local ? this.models.localLabel : model.model };
      yield { type: 'stage', stage: 'searching' };
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
      if (readable.length === 0) {
        yield outOfScope;
        return;
      }

      const queryEmbedding = await this.callModel(() => this.llm.embedText(input.question));
      const chunks = (
        await this.retrieval.findSimilarChunks(queryEmbedding, readable.map((m) => m.id), TOP_K)
      ).filter((c) => Number(c.similarity) >= MIN_SIMILARITY);

      // Short-circuit: no relevant context → refuse without calling the LLM (zero hallucination surface).
      if (chunks.length === 0) {
        yield outOfScope;
        return;
      }

      // Trimming passages to their best sentences only pays off on a slow local model.
      const trim = local && env.TUTOR_CONTEXT_TOKENS > 0;
      if (trim) yield { type: 'stage', stage: 'selecting' };
      const passages = trim
        ? await this.selectPassages(chunks, input.question, queryEmbedding)
        : chunks.map((passage) => ({ passage, text: passage.content }));
      const citations = passages.map(({ passage: c, text }, i) => ({
        sourceId: `S${i + 1}`,
        materialId: c.materialId,
        materialTitle: c.materialTitle,
        chunkIndex: c.chunkIndex,
        excerpt: text.slice(0, 280),
        similarity: Math.round(Number(c.similarity) * 1000) / 1000,
      }));
      yield { type: 'sources', citations };

      const messages = this.buildMessages(input, passages, local ? env.TUTOR_HISTORY_MESSAGES : HOSTED_HISTORY_MESSAGES);
      if (signal.aborted) return;
      const backgroundBusy = local && (await this.priority.backgroundBusy());
      if (backgroundBusy) yield { type: 'stage', stage: 'waiting' };

      const promptTokens = estimateTokens(messages.map((m) => m.content).join('\n')) + 20;
      yield {
        type: 'stage',
        stage: 'reading',
        promptTokens,
        estimatedSeconds: Math.max(1, Math.round(promptTokens / this.readSpeedFor(model).tokensPerSecond)),
      };

      let answer = '';
      for await (const event of this.streamModel(model, messages, signal, promptTokens, backgroundBusy)) {
        if (event.type === 'text') answer += event.text;
        yield event;
      }
      if (signal.aborted) return;
      answer = answer.trim();
      yield finish({
        answer: answer || OUT_OF_SCOPE_ANSWER,
        grounded: answer !== '' && normaliseRefusal(answer) !== normaliseRefusal(OUT_OF_SCOPE_ANSWER),
        citations,
      });
    } finally {
      this.answersInFlight--;
      if (local) this.lastModelUse = Date.now();
      await release();
    }
  }

  /** The student's model; a saved hosted key that no longer works is reported, not silently swapped. */
  private async resolveModel(user: AuthenticatedUser): Promise<ChatModel> {
    try {
      return await this.models.forUser(user.id);
    } catch (error) {
      if (error instanceof ModelError) {
        throw new BadRequestException(describeModelError(error.kind, error.providerLabel ?? 'Your AI provider', error.detail));
      }
      throw error;
    }
  }

  private readSpeedFor(model: ChatModel): ReadSpeed {
    const key = `${model.providerId}:${model.model}`;
    let speed = this.readSpeeds.get(key);
    if (!speed) {
      speed = new ReadSpeed(model.kind === 'local' ? env.TUTOR_READ_TOKENS_PER_SEC : HOSTED_READ_TOKENS_PER_SEC);
      this.readSpeeds.set(key, speed);
    }
    return speed;
  }

  /** The best sentences of each retrieved passage, within TUTOR_CONTEXT_TOKENS (0 = whole passages). */
  private async selectPassages(chunks: RetrievedChunk[], question: string, queryEmbedding: number[]) {
    if (env.TUTOR_CONTEXT_TOKENS === 0) return chunks.map((passage) => ({ passage, text: passage.content }));
    try {
      return await compressPassages(chunks, question, queryEmbedding, env.TUTOR_CONTEXT_TOKENS, (texts) =>
        this.llm.embedTexts(texts, 'document'),
      );
    } catch (error) {
      this.logger.warn(`Passage selection failed, sending whole passages: ${error}`);
      return chunks.map((passage) => ({ passage, text: passage.content }));
    }
  }

  private buildMessages(
    input: TutorQueryInput,
    passages: { passage: RetrievedChunk; text: string }[],
    historyMessages: number,
  ): ChatMessage[] {
    const context = passages
      .map(
        ({ passage, text }, i) =>
          `<source id="S${i + 1}" material="${neutraliseTags(passage.materialTitle).replace(/"/g, "'")}">\n${neutraliseTags(text)}\n</source>`,
      )
      .join('\n\n');
    const history = historyMessages === 0 ? [] : input.history.slice(-historyMessages);
    return [
      { role: 'system', content: TUTOR_SYSTEM_PROMPT },
      ...history.map((turn) => ({
        role: turn.role,
        content:
          turn.content.length > HISTORY_MESSAGE_MAX_CHARS
            ? `${turn.content.slice(0, HISTORY_MESSAGE_MAX_CHARS)}…`
            : turn.content,
      })),
      { role: 'user', content: `Course sources:\n${context}\n\nStudent question: ${input.question}` },
    ];
  }

  /** The model's answer as it is written, bounded by TUTOR_TIMEOUT_MS; records the read speed. */
  private async *streamModel(
    model: ChatModel,
    messages: ChatMessage[],
    signal: AbortSignal,
    estimatedPromptTokens: number,
    waitedForBackground: boolean,
  ): AsyncGenerator<TutorEvent> {
    const timeout = AbortSignal.timeout(env.TUTOR_TIMEOUT_MS);
    const sent = Date.now();
    let readSeconds = 0;
    try {
      for await (const event of this.llm.streamChatCompletion(
        messages,
        env.TUTOR_MAX_TOKENS,
        AbortSignal.any([signal, timeout]),
        model,
      )) {
        if (event.type === 'text') {
          if (!readSeconds) {
            readSeconds = (Date.now() - sent) / 1000;
            yield { type: 'stage', stage: 'writing', readSeconds: Math.round(readSeconds) };
          }
          yield event;
        } else if (!waitedForBackground && readSeconds) {
          // A measurement taken while generation was stepping aside includes that wait.
          this.readSpeedFor(model).record(event.promptTokens || estimatedPromptTokens, readSeconds);
        }
      }
    } catch (error) {
      if (signal.aborted) return; // the student stopped it: nothing to report
      if (timeout.aborted) throw new ServiceUnavailableException(TUTOR_TIMEOUT_MESSAGE);
      if (model.kind === 'hosted' && error instanceof ModelError) {
        // The student's own provider: say exactly what to fix (key, credit, model).
        this.logger.warn(`Hosted tutor call failed (${error.kind}): ${error.message}`);
        const message = describeModelError(error.kind, model.providerLabel, error.detail);
        throw error.kind === 'unavailable' ? new BadGatewayException(message) : new BadRequestException(message);
      }
      if (isLlmUnavailableError(error)) {
        this.logger.warn(`Tutor model unavailable: ${error}`);
        throw new ServiceUnavailableException(TUTOR_BUSY_MESSAGE);
      }
      throw error;
    }
  }

  /** Model outages become a 503 with a readable message instead of a generic 500. */
  private async callModel<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (isLlmUnavailableError(error)) {
        this.logger.warn(`Tutor model unavailable: ${error}`);
        throw new ServiceUnavailableException(TUTOR_BUSY_MESSAGE);
      }
      throw error;
    }
  }
}
