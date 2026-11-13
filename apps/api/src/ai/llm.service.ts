import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import OpenAI from 'openai';
import type { z, ZodTypeAny } from 'zod';
import { env } from '../config/env';
import { LocalEmbedder } from './local-embedder';
import { ModelPriorityService } from './model-priority.service';
import { ModelResolverService } from './model-resolver.service';
import { ChatMessage, ChatModel, ModelError } from './providers/chat-model';

export type { ChatMessage, ChatModel } from './providers/chat-model';

const EMBEDDING_BATCH_SIZE = 64;
/** Room for a JSON answer with several cards/questions (local servers cap this themselves). */
const STRUCTURED_MAX_TOKENS = 4_000;

/** The model server is down, unreachable or too slow — as opposed to a bad model answer. */
export function isLlmUnavailableError(error: unknown): boolean {
  return (
    (error instanceof ModelError && error.kind === 'unavailable') ||
    error instanceof OpenAI.APIConnectionError || // embeddings API (includes timeouts)
    (error instanceof OpenAI.APIError && (error.status === 503 || error.status === 502 || error.status === 504))
  );
}

/** Serialises an embedding for a parameterised `$1::vector` cast. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.map((n) => (Number.isFinite(n) ? n : 0)).join(',')}]`;
}

/** Removes reasoning blocks that "thinking" models (Qwen3, DeepSeek-R1, …) may emit before the answer. */
export function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '') // opening tag consumed by the server's chat template
    .trim();
}

/**
 * Lenient JSON extraction for servers without a JSON mode: tolerates reasoning blocks,
 * ```json fences and prose around the object. Throws if no JSON object can be parsed.
 */
export function extractJsonObject(raw: string): unknown {
  const text = stripReasoning(raw);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  for (const candidate of [text, fenced]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate.trim());
    } catch {
      /* try the next form */
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new SyntaxError('No JSON object in model output');
}

/**
 * Gateway for all model I/O. Chat goes to a ChatModel: the server's local model by default,
 * or the hosted model a student connected (ModelResolverService). Embeddings always use the
 * server's own embedding model, so document search is the same whoever answers.
 */
@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  /** Only for EMBEDDING_PROVIDER=api. */
  private readonly embeddingClient = new OpenAI({
    apiKey: env.EMBEDDING_API_KEY || env.LLM_API_KEY,
    baseURL: env.EMBEDDING_BASE_URL || env.LLM_BASE_URL,
    timeout: env.LLM_TIMEOUT_MS,
    maxRetries: env.LLM_MAX_RETRIES,
  });
  private readonly localEmbedder = env.EMBEDDING_PROVIDER === 'local' ? new LocalEmbedder() : null;
  private readonly supportsDimensionsParam = env.EMBEDDING_MODEL.startsWith('text-embedding-3');

  constructor(private readonly models: ModelResolverService) {}

  onModuleInit() {
    // Warm the local model in the background so the first upload/tutor question doesn't wait for it.
    this.localEmbedder?.load().catch((error) => this.logger.warn(`Local embedding model not loaded yet: ${error}`));
  }

  /** `kind` selects the model's task prefix: material chunks are documents, tutor questions are queries. */
  async embedTexts(texts: string[], kind: 'document' | 'query' = 'document'): Promise<number[][]> {
    const prefix = (kind === 'query' ? env.EMBEDDING_QUERY_PREFIX : env.EMBEDDING_DOCUMENT_PREFIX).trim();
    const inputs = prefix ? texts.map((t) => `${prefix} ${t}`) : texts;
    const embeddings = this.localEmbedder
      ? await this.localEmbedder.embed(inputs)
      : await this.embedViaApi(inputs);
    for (const embedding of embeddings) {
      if (embedding.length !== env.EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Embedding dimension ${embedding.length} != EMBEDDING_DIMENSIONS ${env.EMBEDDING_DIMENSIONS}`,
        );
      }
    }
    return embeddings;
  }

  async embedText(text: string): Promise<number[]> {
    const [embedding] = await this.embedTexts([text], 'query');
    return embedding;
  }

  private async embedViaApi(inputs: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (let i = 0; i < inputs.length; i += EMBEDDING_BATCH_SIZE) {
      const response = await this.embeddingClient.embeddings.create({
        model: env.EMBEDDING_MODEL,
        input: inputs.slice(i, i + EMBEDDING_BATCH_SIZE),
        ...(this.supportsDimensionsParam ? { dimensions: env.EMBEDDING_DIMENSIONS } : {}),
      });
      for (const item of [...response.data].sort((a, b) => a.index - b.index)) {
        embeddings.push(item.embedding);
      }
    }
    return embeddings;
  }

  /**
   * JSON completion validated against a Zod schema; one corrective retry. `signal` cancels the
   * request (the model server stops working on it), e.g. to let a tutor question go first.
   */
  async generateStructuredOutput<T extends ZodTypeAny>(
    schema: T,
    systemPrompt: string,
    userPrompt: string,
    options: { signal?: AbortSignal; model?: ChatModel } = {},
  ): Promise<z.infer<T>> {
    const model = options.model ?? this.models.local;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const raw = await model.complete({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxTokens: STRUCTURED_MAX_TOKENS,
        temperature: 0.2,
        json: true,
        signal: options.signal,
      });
      try {
        const parsed = schema.safeParse(extractJsonObject(raw));
        if (parsed.success) return parsed.data;
        this.logger.warn(`Structured output failed validation (attempt ${attempt})`);
      } catch {
        this.logger.warn(`Structured output was not JSON (attempt ${attempt})`);
      }
    }
    throw new Error('LLM returned invalid structured output');
  }

  async generateChatCompletion(
    messages: ChatMessage[],
    maxTokens = 900,
    requestOptions: { timeoutMs?: number; maxRetries?: number; signal?: AbortSignal; model?: ChatModel } = {},
  ) {
    const model = requestOptions.model ?? this.models.local;
    const text = await model.complete({
      messages,
      maxTokens,
      temperature: 0.1,
      signal: requestOptions.signal,
      timeoutMs: requestOptions.timeoutMs,
      maxRetries: requestOptions.maxRetries,
    });
    return stripReasoning(text);
  }

  /**
   * Streams a chat answer as it is written. Yields text pieces (reasoning blocks removed),
   * then one `usage` event with the server's token counts when it reports them.
   * Cancelling `signal` stops the request and frees the model.
   */
  async *streamChatCompletion(
    messages: ChatMessage[],
    maxTokens: number,
    signal: AbortSignal,
    model: ChatModel = this.models.local,
  ): AsyncGenerator<ChatStreamEvent> {
    const filter = new ReasoningFilter();
    for await (const event of model.stream({
      messages,
      maxTokens,
      temperature: 0.1,
      signal,
      maxRetries: 0,
      timeoutMs: env.LLM_TIMEOUT_MS,
    })) {
      if (event.type === 'usage') {
        yield event;
        continue;
      }
      const piece = filter.push(event.text);
      if (piece) yield { type: 'text', text: piece };
    }
    const rest = filter.flush();
    if (rest) yield { type: 'text', text: rest };
  }
}

export type ChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number };

/**
 * Streaming counterpart of stripReasoning: holds back a leading <think>…</think> block and
 * passes everything after it through unchanged. (Servers run with thinking off, like
 * colibri --no-think, never send one; this only keeps a thinking model's notes off screen.)
 */
export class ReasoningFilter {
  private buffer = '';
  private passthrough = false;

  push(piece: string): string {
    if (this.passthrough) return piece;
    this.buffer += piece;
    const close = this.buffer.search(/<\/think>/i);
    if (close !== -1) {
      this.passthrough = true;
      return this.buffer.slice(close + '</think>'.length).trimStart();
    }
    const head = this.buffer.trimStart().toLowerCase();
    if (head === '' || head.startsWith('<think>') || '<think>'.startsWith(head)) return ''; // wait
    this.passthrough = true;
    return this.buffer.trimStart();
  }

  /** Whatever is still held when the stream ends (an unterminated reasoning block is dropped). */
  flush(): string {
    return this.passthrough ? '' : stripReasoning(this.buffer.replace(/^\s*<think>[\s\S]*$/i, ''));
  }
}

@Global()
@Module({
  providers: [LlmService, ModelPriorityService, ModelResolverService],
  exports: [LlmService, ModelPriorityService, ModelResolverService],
})
export class LlmModule {}
