import { Injectable, Logger } from '@nestjs/common';
import { AiMode } from '@prisma/client';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicChatModel } from './providers/anthropic';
import { ChatModel, ModelError } from './providers/chat-model';
import { CredentialCipher, keyHint } from './providers/credential-cipher';
import { findHostedProvider, HostedProvider } from './providers/hosted-providers';
import { OpenAICompatibleChatModel } from './providers/openai-compatible';

/** Hosted calls are interactive-speed: fail within this, don't wait the local model's 15 min. */
const HOSTED_TIMEOUT_MS = 120_000;
const CACHE_LIMIT = 500;

/**
 * Decides which model serves a user: the server's free local model (default), or the hosted
 * provider they connected with their own API key. Clients are cached per user and rebuilt
 * when the user's settings change.
 */
@Injectable()
export class ModelResolverService {
  private readonly logger = new Logger(ModelResolverService.name);
  readonly local: ChatModel = new OpenAICompatibleChatModel({
    kind: 'local',
    providerId: 'local',
    providerLabel: 'Local model',
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    model: env.LLM_CHAT_MODEL,
    jsonMode: env.LLM_JSON_MODE === 'json_object',
  });
  private readonly cipher = env.LLM_CREDENTIALS_KEY ? new CredentialCipher(env.LLM_CREDENTIALS_KEY) : null;
  private readonly cache = new Map<string, { stamp: number; model: ChatModel }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Hosted models need LLM_CREDENTIALS_KEY to store keys safely. */
  get hostedAvailable(): boolean {
    return this.cipher !== null;
  }

  get localLabel(): string {
    return env.LLM_LOCAL_LABEL || env.LLM_CHAT_MODEL;
  }

  /** The model for this user's AI requests. A broken saved key surfaces as a ModelError('auth'). */
  async forUser(userId: string): Promise<ChatModel> {
    if (!this.cipher) return this.local;
    const pref = await this.prisma.aiPreference.findUnique({ where: { userId } });
    if (pref?.mode !== AiMode.HOSTED) return this.local;
    return (await this.savedHosted(userId, pref)) ?? this.local;
  }

  /**
   * The hosted model the user saved under AI model settings, whichever mode is selected there
   * (a generation run can pick it explicitly). null when none is saved.
   */
  async hostedForUser(userId: string): Promise<ChatModel | null> {
    if (!this.cipher) return null;
    const pref = await this.prisma.aiPreference.findUnique({ where: { userId } });
    return pref ? this.savedHosted(userId, pref) : null;
  }

  private async savedHosted(
    userId: string,
    pref: { provider: string | null; model: string | null; apiKeyCiphertext: string | null; updatedAt: Date },
  ): Promise<ChatModel | null> {
    if (!this.cipher || !pref.provider || !pref.model || !pref.apiKeyCiphertext) return null;
    const stamp = pref.updatedAt.getTime();
    const cached = this.cache.get(userId);
    if (cached?.stamp === stamp) return cached.model;

    const provider = findHostedProvider(pref.provider);
    if (!provider) {
      this.logger.warn(`User ${userId} has unknown provider "${pref.provider}"`);
      return null;
    }
    let apiKey: string;
    try {
      apiKey = this.cipher.decrypt(pref.apiKeyCiphertext);
    } catch {
      // e.g. LLM_CREDENTIALS_KEY was rotated: the student must enter the key again.
      throw new ModelError('auth', 'Saved API key could not be decrypted', provider.label);
    }
    const model = this.build(provider, apiKey, pref.model);
    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(userId, { stamp, model });
    return model;
  }

  /** A client for a provider/key/model that is not saved yet (connection test, model list). */
  build(provider: HostedProvider, apiKey: string, model: string): ChatModel {
    if (provider.api === 'anthropic') return new AnthropicChatModel(apiKey, model, provider.label);
    return new OpenAICompatibleChatModel({
      kind: 'hosted',
      providerId: provider.id,
      providerLabel: provider.label,
      baseURL: provider.baseURL!,
      apiKey,
      model,
      jsonMode: provider.jsonMode,
      reasoningParams: provider.openaiReasoningParams,
      timeoutMs: HOSTED_TIMEOUT_MS,
      maxRetries: 1,
    });
  }

  /** Encrypts a key for storage; returns what to save. Requires hostedAvailable. */
  seal(apiKey: string): { apiKeyCiphertext: string; apiKeyHint: string } {
    if (!this.cipher) throw new Error('Hosted models are not enabled (LLM_CREDENTIALS_KEY is unset)');
    return { apiKeyCiphertext: this.cipher.encrypt(apiKey), apiKeyHint: keyHint(apiKey) };
  }

  /** The saved key, for re-testing or listing models without asking the student again. */
  unseal(apiKeyCiphertext: string): string {
    if (!this.cipher) throw new Error('Hosted models are not enabled');
    return this.cipher.decrypt(apiKeyCiphertext);
  }

  forget(userId: string) {
    this.cache.delete(userId);
  }
}
