import { z } from 'zod';

const base64Pem = z
  .string()
  .min(1)
  .transform((value) => Buffer.from(value, 'base64').toString('utf8'))
  .refine((pem) => pem.includes('-----BEGIN'), 'must be a base64-encoded PEM');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  JWT_PRIVATE_KEY_B64: base64Pem,
  JWT_PUBLIC_KEY_B64: base64Pem,
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  UPLOAD_DIR: z.string().default('./storage/uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  LLM_BASE_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  LLM_API_KEY: z.string().min(1),
  LLM_CHAT_MODEL: z.string().min(1).default('gpt-4o-mini'),
  EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  /** Local CPU inference is slow; raise this (e.g. 300000) when LLM_BASE_URL points at Ollama. */
  LLM_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(900_000).default(60_000),
  /** Task prefixes some embedding models expect (nomic-embed-text: "search_document:" / "search_query:"). */
  EMBEDDING_DOCUMENT_PREFIX: z.string().default(''),
  EMBEDDING_QUERY_PREFIX: z.string().default(''),
  /** Below this cosine similarity a retrieved chunk is treated as irrelevant. Tune per embedding model. */
  TUTOR_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.3),
});

export type AppEnv = z.infer<typeof envSchema>;

function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast; print variable names only, never values.
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    console.error(`Invalid environment configuration:\n${problems.join('\n')}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
