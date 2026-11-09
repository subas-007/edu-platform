import { Global, Injectable, Logger, Module } from '@nestjs/common';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { z, ZodTypeAny } from 'zod';
import { env } from '../config/env';

const EMBEDDING_BATCH_SIZE = 64;

/** The model server is down, unreachable or too slow — as opposed to a bad model answer. */
export function isLlmUnavailableError(error: unknown): boolean {
  return (
    error instanceof OpenAI.APIConnectionError || // includes APIConnectionTimeoutError
    (error instanceof OpenAI.APIError && (error.status === 503 || error.status === 502 || error.status === 504))
  );
}

/** Serialises an embedding for a parameterised `$1::vector` cast. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.map((n) => (Number.isFinite(n) ? n : 0)).join(',')}]`;
}

/**
 * Provider-agnostic gateway over any OpenAI-compatible API (OpenAI, Azure,
 * vLLM, Ollama, LM Studio). All model I/O in the system goes through here.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client = new OpenAI({
    apiKey: env.LLM_API_KEY,
    baseURL: env.LLM_BASE_URL,
    timeout: env.LLM_TIMEOUT_MS,
    maxRetries: 2,
  });
  private readonly supportsDimensionsParam = env.EMBEDDING_MODEL.startsWith('text-embedding-3');

  /** `kind` selects the model's task prefix: material chunks are documents, tutor questions are queries. */
  async embedTexts(texts: string[], kind: 'document' | 'query' = 'document'): Promise<number[][]> {
    const prefix = (kind === 'query' ? env.EMBEDDING_QUERY_PREFIX : env.EMBEDDING_DOCUMENT_PREFIX).trim();
    const inputs = prefix ? texts.map((t) => `${prefix} ${t}`) : texts;
    const embeddings: number[][] = [];
    for (let i = 0; i < inputs.length; i += EMBEDDING_BATCH_SIZE) {
      const response = await this.client.embeddings.create({
        model: env.EMBEDDING_MODEL,
        input: inputs.slice(i, i + EMBEDDING_BATCH_SIZE),
        ...(this.supportsDimensionsParam ? { dimensions: env.EMBEDDING_DIMENSIONS } : {}),
      });
      for (const item of [...response.data].sort((a, b) => a.index - b.index)) {
        if (item.embedding.length !== env.EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Embedding dimension ${item.embedding.length} != EMBEDDING_DIMENSIONS ${env.EMBEDDING_DIMENSIONS}`,
          );
        }
        embeddings.push(item.embedding);
      }
    }
    return embeddings;
  }

  async embedText(text: string): Promise<number[]> {
    const [embedding] = await this.embedTexts([text], 'query');
    return embedding;
  }

  /** JSON-mode completion validated against a Zod schema; one corrective retry. */
  async generateStructuredOutput<T extends ZodTypeAny>(
    schema: T,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<z.infer<T>> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const completion = await this.client.chat.completions.create({
        model: env.LLM_CHAT_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? '';
      try {
        const parsed = schema.safeParse(JSON.parse(raw));
        if (parsed.success) return parsed.data;
        this.logger.warn(`Structured output failed validation (attempt ${attempt})`);
      } catch {
        this.logger.warn(`Structured output was not JSON (attempt ${attempt})`);
      }
    }
    throw new Error('LLM returned invalid structured output');
  }

  async generateChatCompletion(
    messages: ChatCompletionMessageParam[],
    maxTokens = 900,
    requestOptions?: { timeoutMs?: number; maxRetries?: number },
  ) {
    const completion = await this.client.chat.completions.create(
      {
        model: env.LLM_CHAT_MODEL,
        temperature: 0.1,
        max_tokens: maxTokens,
        messages,
      },
      { timeout: requestOptions?.timeoutMs, maxRetries: requestOptions?.maxRetries },
    );
    return completion.choices[0]?.message?.content?.trim() ?? '';
  }
}

@Global()
@Module({ providers: [LlmService], exports: [LlmService] })
export class LlmModule {}
