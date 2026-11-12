import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  BetaMessageParam,
  MessageCreateParamsBase,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
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
 * Claude models that support server-side refusal fallbacks: on a safety decline the API
 * re-runs the request on a fallback model inside the same call (fallbacks: "default").
 */
const FALLBACK_MODELS = /^claude-(opus-5-5|sonnet-5-5|fable-5-[12])$/;
/** The Claude 5 generation accepts output_config.effort; older models reject it. */
const EFFORT_MODELS = /^claude-(opus|sonnet|haiku|fable|mythos)-5/;

/** A student's own Anthropic account, through the official SDK. */
export class AnthropicChatModel implements ChatModel {
  readonly kind = 'hosted' as const;
  readonly providerId = 'anthropic';
  private readonly client: Anthropic;
  /**
   * Refusal fallbacks are a beta; an account not enabled for it gets a 400 on every request.
   * The first such 400 turns them off for this client and the request is sent again without.
   */
  private useFallbacks: boolean;

  constructor(
    apiKey: string,
    readonly model: string,
    readonly providerLabel: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 1 });
    this.useFallbacks = FALLBACK_MODELS.test(model);
  }

  async complete(request: ChatRequest): Promise<string> {
    let message: BetaMessage;
    try {
      message = await this.withFallbackRetry(() =>
        this.client.beta.messages.create({ ...this.params(request), stream: false }, sdkRequestOptions(request)),
      );
    } catch (error) {
      throw this.toModelError(error);
    }
    this.assertNotRefused(message);
    return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  }

  async *stream(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    try {
      // A rejected beta fails before any text arrives, so the stream can be opened again.
      const stream = await this.withFallbackRetry(async () => {
        const opened = this.client.beta.messages.stream(this.params(request), sdkRequestOptions(request));
        await opened.withResponse();
        return opened;
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        }
      }
      const message = await stream.finalMessage();
      this.assertNotRefused(message);
      yield {
        type: 'usage',
        promptTokens: message.usage.input_tokens,
        completionTokens: message.usage.output_tokens,
      };
    } catch (error) {
      throw this.toModelError(error);
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const ids: string[] = [];
      for await (const model of this.client.models.list({ limit: 100 }, { timeout: 20_000, maxRetries: 0 })) {
        ids.push(model.id);
      }
      return ids;
    } catch (error) {
      throw this.toModelError(error);
    }
  }

  private params(request: ChatRequest): MessageCreateParamsBase {
    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const messages: BetaMessageParam[] = request.messages
      .filter((m): m is typeof m & { role: 'user' | 'assistant' } => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));
    while (messages.length > 0 && messages[0].role === 'assistant') messages.shift(); // must start with user
    const json = request.json ? '\nRespond with the JSON object only: no markdown, no explanations.' : '';
    return {
      model: this.model,
      max_tokens: request.maxTokens,
      ...(system || json ? { system: system + json } : {}),
      messages,
      // Short, factual answers: the lowest effort keeps them fast and cheap.
      ...(EFFORT_MODELS.test(this.model) ? { output_config: { effort: 'low' as const } } : {}),
      ...(this.useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    };
  }

  private async withFallbackRetry<T>(send: () => Promise<T>): Promise<T> {
    try {
      return await send();
    } catch (error) {
      if (!this.useFallbacks || !(error instanceof Anthropic.BadRequestError)) throw error;
      this.useFallbacks = false;
      return send();
    }
  }

  /** stop_reason "refusal" arrives as a normal 200 response: surface it as an error. */
  private assertNotRefused(message: BetaMessage) {
    if (message.stop_reason === 'refusal') {
      throw new ModelError('refusal', 'The model declined to answer', this.providerLabel);
    }
  }

  private toModelError(error: unknown): unknown {
    if (error instanceof ModelError || error instanceof Anthropic.APIUserAbortError) return error;
    const kind = classifyAnthropicError(error);
    if (kind === null) return error;
    // The SDK keeps the response body on .error: {type: "error", error: {type, message}}.
    const body = (error as { error?: { error?: { message?: string }; message?: string } }).error;
    const detail = providerDetail(body?.error?.message ?? body?.message ?? (error as Error).message);
    return Object.assign(new ModelError(kind, String((error as Error).message ?? error), this.providerLabel, detail), {
      cause: error,
    });
  }
}

/** Most specific first: APIConnectionError is a subclass of APIError in the TypeScript SDK. */
function classifyAnthropicError(error: unknown): ModelErrorKind | null {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return 'auth';
  if (error instanceof Anthropic.RateLimitError) return 'quota';
  if (error instanceof Anthropic.NotFoundError || error instanceof Anthropic.BadRequestError) {
    // An empty account is a 400 ("Your credit balance is too low…"), not a model problem.
    if (/credit balance|billing|purchase credits/i.test(error.message)) return 'quota';
    return 'model';
  }
  if (error instanceof Anthropic.APIConnectionError) return 'unavailable';
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    if (status === 402) return 'quota';
    if (status >= 500) return 'unavailable'; // includes 529 overloaded
    return 'other';
  }
  return null;
}
