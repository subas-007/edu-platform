import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import OpenAI, { type ClientOptions } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Agent, fetch as undiciFetch } from 'undici';
import type { z, ZodTypeAny } from 'zod';
import { env } from '../config/env';
import { LocalEmbedder } from './local-embedder';

const EMBEDDING_BATCH_SIZE = 64;

/** The model server is down, unreachable or too slow — as opposed to a bad model answer. */
export function isLlmUnavailableError(error: unknown): boolean {
  return (
    error instanceof OpenAI.APIConnectionError || // includes APIConnectionTimeoutError
    (error instanceof OpenAI.APIError && (error.status === 503 || error.status === 502 || error.status === 504))
  );
}

/**
 * Local servers (colibri, llama.cpp…) send response headers only once the whole answer is
 * generated. Node's built-in fetch gives up after 300 s without headers (UND_ERR_HEADERS_TIMEOUT),
 * which would cap every model call at 5 minutes regardless of LLM_TIMEOUT_MS. This agent defers
 * to the SDK's own per-request timeout instead.
 */
const modelHttpAgent = new Agent({
  headersTimeout: env.LLM_TIMEOUT_MS + 60_000,
  bodyTimeout: env.LLM_TIMEOUT_MS + 60_000,
  connectTimeout: 10_000,
});
const modelClientTransport = {
  fetch: undiciFetch as unknown as typeof fetch,
  fetchOptions: { dispatcher: modelHttpAgent } as unknown as ClientOptions['fetchOptions'],
};

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
 * Provider-agnostic gateway over any OpenAI-compatible API (OpenAI, Azure, vLLM, Ollama,
 * LM Studio, colibri) plus optional in-process embeddings. All model I/O goes through here.
 */
@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private readonly client = new OpenAI({
    apiKey: env.LLM_API_KEY,
    baseURL: env.LLM_BASE_URL,
    timeout: env.LLM_TIMEOUT_MS,
    maxRetries: env.LLM_MAX_RETRIES,
    ...modelClientTransport,
  });
  /** Embeddings may be served by a different endpoint than chat. */
  private readonly embeddingClient =
    env.EMBEDDING_PROVIDER === 'api' && env.EMBEDDING_BASE_URL
      ? new OpenAI({
          apiKey: env.EMBEDDING_API_KEY || env.LLM_API_KEY,
          baseURL: env.EMBEDDING_BASE_URL,
          timeout: env.LLM_TIMEOUT_MS,
          maxRetries: env.LLM_MAX_RETRIES,
          ...modelClientTransport,
        })
      : this.client;
  private readonly localEmbedder = env.EMBEDDING_PROVIDER === 'local' ? new LocalEmbedder() : null;
  private readonly supportsDimensionsParam = env.EMBEDDING_MODEL.startsWith('text-embedding-3');

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

  /** JSON completion validated against a Zod schema; one corrective retry. */
  async generateStructuredOutput<T extends ZodTypeAny>(
    schema: T,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<z.infer<T>> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const completion = await this.client.chat.completions.create({
        model: env.LLM_CHAT_MODEL,
        temperature: 0.2,
        ...(env.LLM_JSON_MODE === 'json_object' ? { response_format: { type: 'json_object' as const } } : {}),
        messages: [
          {
            role: 'system',
            content:
              env.LLM_JSON_MODE === 'prompt'
                ? `${systemPrompt}\nRespond with the JSON object only: no markdown, no explanations.`
                : systemPrompt,
          },
          { role: 'user', content: userPrompt },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? '';
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
    return stripReasoning(completion.choices[0]?.message?.content ?? '');
  }
}

@Global()
@Module({ providers: [LlmService], exports: [LlmService] })
export class LlmModule {}
