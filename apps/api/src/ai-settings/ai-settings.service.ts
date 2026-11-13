import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiMode } from '@prisma/client';
import { z } from 'zod';
import { ModelResolverService } from '../ai/model-resolver.service';
import { describeModelError, ModelError } from '../ai/providers/chat-model';
import { findHostedProvider, HOSTED_PROVIDERS, HostedProvider } from '../ai/providers/hosted-providers';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';

/** Keys are opaque tokens: no spaces or control characters, sane length. */
const apiKeySchema = z
  .string()
  .trim()
  .min(10, 'That does not look like an API key')
  .max(400)
  .regex(/^[\x21-\x7E]+$/, 'API keys contain no spaces or special characters');
const modelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._:/@-]+$/, 'Model ids contain only letters, digits and . _ : / @ -');
const providerIdSchema = z.string().refine((id) => findHostedProvider(id) !== undefined, 'Unknown provider');

export const updateAiSettingsSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('LOCAL') }).strict(),
  z
    .object({
      mode: z.literal('HOSTED'),
      provider: providerIdSchema,
      model: modelIdSchema,
      /** Omit to keep the key already saved for this provider. */
      apiKey: apiKeySchema.optional(),
    })
    .strict(),
]);
export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;

export const listModelsSchema = z
  .object({ provider: providerIdSchema, apiKey: apiKeySchema.optional() })
  .strict();
export type ListModelsInput = z.infer<typeof listModelsSchema>;

const TEST_TIMEOUT_MS = 30_000;

@Injectable()
export class AiSettingsService {
  private readonly logger = new Logger(AiSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly models: ModelResolverService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** What the settings page shows. Never includes the key itself. */
  async getSettings(userId: string) {
    const pref = await this.prisma.aiPreference.findUnique({ where: { userId } });
    const hostedAvailable = this.models.hostedAvailable;
    return {
      mode: hostedAvailable && pref?.mode === AiMode.HOSTED ? AiMode.HOSTED : AiMode.LOCAL,
      provider: pref?.provider ?? null,
      model: pref?.model ?? null,
      keyHint: pref?.apiKeyCiphertext ? pref.apiKeyHint : null,
      hostedAvailable,
      local: { label: this.models.localLabel },
      providers: HOSTED_PROVIDERS.map(({ id, label, keysUrl, suggestedModels }) => ({
        id,
        label,
        keysUrl,
        suggestedModels,
      })),
    };
  }

  /**
   * Switching to HOSTED makes one tiny request with the key first, so a wrong key, model or
   * empty account is reported here rather than in the middle of a tutor answer.
   */
  async updateSettings(userId: string, input: UpdateAiSettingsInput, ip?: string) {
    if (input.mode === AiMode.LOCAL) {
      await this.prisma.aiPreference.upsert({
        where: { userId },
        create: { userId, mode: AiMode.LOCAL },
        update: { mode: AiMode.LOCAL }, // the saved key stays, so switching back needs no re-entry
      });
      this.models.forget(userId);
      await this.audit(userId, { mode: AiMode.LOCAL }, ip);
      return { settings: await this.getSettings(userId), test: null };
    }

    this.assertHostedAvailable();
    const provider = findHostedProvider(input.provider)!;
    const apiKey = input.apiKey ?? (await this.savedKeyFor(userId, provider.id));
    if (!apiKey) throw new BadRequestException(`Enter your ${provider.label} API key.`);

    this.logger.log(`User ${userId}: testing ${provider.id}/${input.model} (${input.apiKey ? 'new key' : 'saved key'})`);
    const test = await this.testConnection(provider, apiKey, input.model);
    const sealed = this.models.seal(apiKey);
    const data = { mode: AiMode.HOSTED, provider: provider.id, model: input.model, ...sealed };
    await this.prisma.aiPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    this.models.forget(userId);
    await this.audit(userId, { mode: AiMode.HOSTED, provider: provider.id, model: input.model, keyChanged: !!input.apiKey }, ip);
    this.logger.log(`User ${userId}: now using ${provider.id}/${input.model} (test call ${test.latencyMs} ms)`);
    return { settings: await this.getSettings(userId), test };
  }

  /** Deletes the saved key and returns the user to the local model. */
  async removeKey(userId: string, ip?: string) {
    await this.prisma.aiPreference.upsert({
      where: { userId },
      create: { userId, mode: AiMode.LOCAL },
      update: { mode: AiMode.LOCAL, apiKeyCiphertext: null, apiKeyHint: null },
    });
    this.models.forget(userId);
    await this.audit(userId, { mode: AiMode.LOCAL, keyRemoved: true }, ip);
    return this.getSettings(userId);
  }

  /** Models the key can use, suggested ones first (for the picker). */
  async listModels(userId: string, input: ListModelsInput) {
    this.assertHostedAvailable();
    const provider = findHostedProvider(input.provider)!;
    const apiKey = input.apiKey ?? (await this.savedKeyFor(userId, provider.id));
    if (!apiKey) throw new BadRequestException(`Enter your ${provider.label} API key.`);
    try {
      const available = await this.models.build(provider, apiKey, 'list').listModels();
      const suggested = provider.suggestedModels.map((m) => m.id).filter((id) => available.includes(id));
      return { models: [...suggested, ...available.filter((id) => !suggested.includes(id))] };
    } catch (error) {
      throw this.toHttpError(error, provider);
    }
  }

  private async testConnection(provider: HostedProvider, apiKey: string, model: string) {
    const started = Date.now();
    try {
      await this.models.build(provider, apiKey, model).complete({
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        maxTokens: 16,
        timeoutMs: TEST_TIMEOUT_MS,
        maxRetries: 0,
      });
    } catch (error) {
      throw this.toHttpError(error, provider);
    }
    return { ok: true, latencyMs: Date.now() - started };
  }

  private async savedKeyFor(userId: string, providerId: string): Promise<string | null> {
    const pref = await this.prisma.aiPreference.findUnique({ where: { userId } });
    if (!pref?.apiKeyCiphertext || pref.provider !== providerId) return null; // a key belongs to one provider
    try {
      return this.models.unseal(pref.apiKeyCiphertext);
    } catch {
      return null;
    }
  }

  private assertHostedAvailable() {
    if (!this.models.hostedAvailable) {
      throw new BadRequestException('Hosted models are not enabled on this server. Ask an administrator.');
    }
  }

  private toHttpError(error: unknown, provider: HostedProvider) {
    if (error instanceof ModelError) {
      // The key is never logged; provider messages are already masked (providerDetail).
      this.logger.warn(`${provider.label} rejected the request (${error.kind}): ${error.detail ?? '(no detail)'}`);
      const message = describeModelError(error.kind, provider.label, error.detail);
      return error.kind === 'unavailable' ? new BadGatewayException(message) : new BadRequestException(message);
    }
    this.logger.warn(`${provider.label} connection test failed: ${error}`);
    return new BadGatewayException(`Could not reach ${provider.label}. Please try again.`);
  }

  private audit(userId: string, metadata: Record<string, string | boolean>, ip?: string) {
    // The key itself is never logged.
    return this.auditLog.recordAuditEvent({
      actorId: userId,
      action: 'ai-settings.updated',
      resourceType: 'user',
      resourceId: userId,
      metadata,
      ipAddress: ip,
    });
  }
}
