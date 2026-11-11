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
  /**
   * How structured output (flashcards, questions, roadmap) is requested:
   *  - json_object: OpenAI-style `response_format` (OpenAI, Ollama, vLLM, LM Studio)
   *  - prompt:      the prompt alone asks for JSON and the reply is parsed leniently — for servers
   *                 that reject `response_format` (e.g. colibri: "grammars are not supported")
   */
  LLM_JSON_MODE: z.enum(['json_object', 'prompt']).default('json_object'),
  /** Local CPU inference is slow; raise this when LLM_BASE_URL points at a local server. */
  LLM_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(1_800_000).default(60_000),
  /** SDK retries per generation call. Keep low for slow local models: each retry repeats a full timeout. */
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /**
   * Where embeddings come from:
   *  - api:   an OpenAI-compatible /embeddings endpoint (EMBEDDING_BASE_URL, else LLM_BASE_URL)
   *  - local: computed in-process with transformers.js (ONNX on CPU) — no extra server; use when
   *           the chat server has no embeddings endpoint. EMBEDDING_MODEL is then a Hugging Face id.
   */
  EMBEDDING_PROVIDER: z.enum(['api', 'local']).default('api'),
  EMBEDDING_BASE_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  /** local provider: ONNX weight precision (fp32 = same vectors as the reference model). */
  EMBEDDING_LOCAL_DTYPE: z.enum(['fp32', 'fp16', 'q8']).default('fp32'),
  /** local provider: where model weights are downloaded/cached (first use needs internet). */
  MODEL_CACHE_DIR: z.string().default('./.cache/models'),
  /** Task prefixes some embedding models expect (nomic-embed-text: "search_document:" / "search_query:"). */
  EMBEDDING_DOCUMENT_PREFIX: z.string().default(''),
  EMBEDDING_QUERY_PREFIX: z.string().default(''),
  /** Below this cosine similarity a retrieved chunk is treated as irrelevant. Tune per embedding model. */
  TUTOR_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.3),
  /** Upper bound for one tutor answer (no retries). Keep below the web proxy timeout (API_PROXY_TIMEOUT_MS). */
  TUTOR_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(1_800_000).default(240_000),
  /**
   * Document passages retrieved per tutor question (~500 tokens each). Reading the prompt
   * dominates on slow local models (~4-5 tokens/s on CPU), so fewer passages = faster answers.
   */
  TUTOR_TOP_K: z.coerce.number().int().min(1).max(12).default(6),
  /** Longest tutor answer. Answer time ≈ prompt processing + this ÷ the model's tokens/s. */
  TUTOR_MAX_TOKENS: z.coerce.number().int().min(64).max(4_000).default(900),
  /**
   * Batches of 3 adjacent chunks sampled per material; each batch costs 2 LLM calls.
   * Lower it on CPU-only machines (each local call can take ~1 min).
   */
  GENERATION_MAX_BATCHES: z.coerce.number().int().min(1).max(30).default(10),
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
