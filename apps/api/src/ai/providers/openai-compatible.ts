import OpenAI, { type ClientOptions } from 'openai';
import type { ChatCompletionCreateParamsBase } from 'openai/resources/chat/completions';
import { Agent, fetch as undiciFetch } from 'undici';
import { env } from '../../config/env';
import {
  ChatModel,
  ChatRequest,
  ChatStreamEvent,
  ModelError,
  ModelErrorKind,
  providerDetail,
  sdkRequestOptions,
} from './chat-model';

/**
 * Local servers (colibri, llama.cpp…) may send response headers only once the whole answer
 * is generated. Node's built-in fetch gives up after 300 s without headers
 * (UND_ERR_HEADERS_TIMEOUT), which would cap every call at 5 minutes regardless of the
 * configured timeout. This agent defers to each request's own timeout instead.
 */
const modelHttpAgent = new Agent({
  headersTimeout: env.LLM_TIMEOUT_MS + 60_000,
  bodyTimeout: env.LLM_TIMEOUT_MS + 60_000,
  connectTimeout: 10_000,
});
const transport = {
  fetch: undiciFetch as unknown as typeof fetch,
  fetchOptions: { dispatcher: modelHttpAgent } as unknown as ClientOptions['fetchOptions'],
};

const JSON_INSTRUCTION = '\nRespond with the JSON object only: no markdown, no explanations.';

export interface OpenAICompatibleOptions {
  kind: 'local' | 'hosted';
  providerId: string;
  providerLabel: string;
  /** Unset = the OpenAI API. */
  baseURL?: string;
  apiKey: string;
  model: string;
  /** Send response_format: json_object (servers that support it), else ask in the prompt. */
  jsonMode: boolean;
  /** Newer OpenAI models: max_completion_tokens, default temperature only. */
  reasoningParams?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}

/** Any server with an OpenAI-compatible Chat Completions API: Ollama, colibri, OpenAI, Gemini, Groq… */
export class OpenAICompatibleChatModel implements ChatModel {
  readonly kind: 'local' | 'hosted';
  readonly providerId: string;
  readonly providerLabel: string;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.kind = options.kind;
    this.providerId = options.providerId;
    this.providerLabel = options.providerLabel;
    this.model = options.model;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: options.timeoutMs ?? env.LLM_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? env.LLM_MAX_RETRIES,
      ...transport,
    });
  }

  async complete(request: ChatRequest): Promise<string> {
    try {
      const completion = await this.client.chat.completions.create(
        { ...this.params(request), stream: false },
        this.requestOptions(request),
      );
      return completion.choices[0]?.message?.content ?? '';
    } catch (error) {
      throw this.toModelError(error);
    }
  }

  async *stream(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    try {
      const stream = await this.client.chat.completions.create(
        { ...this.params(request), stream: true, stream_options: { include_usage: true } },
        this.requestOptions(request),
      );
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) yield { type: 'text', text };
        if (chunk.usage) {
          yield {
            type: 'usage',
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
          };
        }
      }
    } catch (error) {
      throw this.toModelError(error);
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const ids: string[] = [];
      for await (const model of this.client.models.list({ timeout: 20_000, maxRetries: 0 })) ids.push(model.id);
      return ids.sort();
    } catch (error) {
      throw this.toModelError(error);
    }
  }

  private params(request: ChatRequest): ChatCompletionCreateParamsBase {
    const messages = request.messages.map((m) => ({ ...m }));
    if (request.json && !this.options.jsonMode) {
      const system = messages.find((m) => m.role === 'system');
      if (system) system.content += JSON_INSTRUCTION;
      else messages.unshift({ role: 'system', content: JSON_INSTRUCTION.trim() });
    }
    const reasoning = this.options.reasoningParams;
    return {
      model: this.model,
      messages,
      // Reasoning models spend part of the budget thinking before they answer.
      ...(reasoning
        ? { max_completion_tokens: Math.max(request.maxTokens * 4, 2_000) }
        : { max_tokens: request.maxTokens }),
      ...(reasoning || request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.json && this.options.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    };
  }

  private requestOptions(request: ChatRequest) {
    return sdkRequestOptions(request);
  }

  private toModelError(error: unknown): unknown {
    if (error instanceof OpenAI.APIUserAbortError) return error; // the caller cancelled: not a model error
    const kind = classifyOpenAIError(error);
    if (kind === null) return error;
    // The SDK keeps the body's `error` object on .error (OpenAI, Groq, OpenRouter); Gemini sends a list.
    const body = (error as { error?: { message?: string } | Array<{ error?: { message?: string } }> }).error;
    const nested = Array.isArray(body) ? body[0]?.error?.message : body?.message;
    const detail = providerDetail(nested ?? (error as Error).message);
    return Object.assign(new ModelError(kind, String((error as Error).message ?? error), this.providerLabel, detail), {
      cause: error,
    });
  }
}

function classifyOpenAIError(error: unknown): ModelErrorKind | null {
  if (error instanceof OpenAI.APIConnectionError) return 'unavailable'; // includes timeouts
  if (!(error instanceof OpenAI.APIError)) return null;
  const status = error.status ?? 0;
  if (status === 401 || status === 403) return 'auth';
  if (status === 402 || status === 429) return 'quota';
  // Gemini reports a bad key as a 400 ("API key not valid. Please pass a valid API key").
  if (status === 400 && /api[ _-]?key/i.test(error.message)) return 'auth';
  if (status === 400 || status === 404 || status === 422) return 'model';
  if (status >= 500 || status === 408) return 'unavailable';
  return 'other';
}
