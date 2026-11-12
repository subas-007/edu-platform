/**
 * One chat model the app can talk to: the local default (Ollama, colibri…) or a student's
 * own hosted provider. Every model call in the app goes through this interface, so the
 * tutor and the generation worker don't care which provider answers.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  maxTokens: number;
  /** Ask for a single JSON object (the caller still validates it). */
  json?: boolean;
  /** Ignored by models that don't accept sampling settings. */
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
}

export type ChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number };

export interface ChatModel {
  /** local = this server's free model; hosted = a provider the student pays for with their own key. */
  readonly kind: 'local' | 'hosted';
  readonly providerId: string;
  readonly providerLabel: string;
  readonly model: string;
  /** Raw answer text (reasoning blocks are the caller's to strip). */
  complete(request: ChatRequest): Promise<string>;
  /** The answer as it is written; then one `usage` event when the provider reports it. */
  stream(request: ChatRequest): AsyncGenerator<ChatStreamEvent>;
  listModels(): Promise<string[]>;
}

/**
 * Per-request SDK options with unset values left out: the SDKs reject `timeout: undefined`
 * ("timeout must be an integer") instead of falling back to the client default.
 */
export function sdkRequestOptions(request: ChatRequest) {
  return {
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
    ...(request.maxRetries !== undefined ? { maxRetries: request.maxRetries } : {}),
  };
}

/** What went wrong with a model call, in terms the UI can explain. */
export type ModelErrorKind =
  | 'auth' // key rejected or not allowed to use the model
  | 'quota' // out of credit, or rate-limited
  | 'model' // unknown model id / bad request for this model
  | 'refusal' // the provider declined to answer
  | 'unavailable' // provider/server down, unreachable or timed out
  | 'other';

export class ModelError extends Error {
  constructor(
    readonly kind: ModelErrorKind,
    message: string,
    readonly providerLabel?: string,
    /** The provider's own explanation (key material masked), shown to the student. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

/** Anything that looks like an API key is masked before a provider message is shown or logged. */
export function maskSecrets(text: string): string {
  return text
    .replace(/\b(sk|rk|pk|gsk|xai|AIza)[-_A-Za-z0-9]{12,}/g, '[key]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[key]');
}

/** Short, single-line version of a provider's error message. */
export function providerDetail(message: string | undefined | null): string | undefined {
  if (!message) return undefined;
  const clean = maskSecrets(message.replace(/\s+/g, ' ').trim());
  return clean.length > 240 ? `${clean.slice(0, 237)}…` : clean || undefined;
}

export function describeModelError(kind: ModelErrorKind, providerLabel: string, detail?: string): string {
  const because = detail ? ` ${providerLabel} said: "${detail}"` : '';
  switch (kind) {
    case 'auth':
      return `${providerLabel} rejected the API key. Check or replace it under AI model settings.${because}`;
    case 'quota':
      return `${providerLabel} refused the request: the account is out of credit or over its rate limit.${because}`;
    case 'model':
      return `${providerLabel} did not accept the request for this model. Check the model name, or pick another under AI model settings.${because}`;
    case 'refusal':
      return `${providerLabel} declined to answer this request.`;
    case 'unavailable':
      return `${providerLabel} is not reachable right now. Please try again in a minute.${because}`;
    default:
      return `${providerLabel} returned an error. Please try again.${because}`;
  }
}
