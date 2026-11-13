import { Logger } from '@nestjs/common';
import { resolve } from 'node:path';
import { env } from '../config/env';

/** Small batches keep peak memory low on CPU (each chunk is up to ~500 tokens). */
const LOCAL_BATCH_SIZE = 8;
/** ~500 tokens of English text. */
const LOCAL_CHUNK_CHARS = 2_000;

type FeatureExtractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * In-process embeddings (EMBEDDING_PROVIDER=local) with transformers.js / ONNX Runtime on CPU.
 *
 * Used when the chat server has no /embeddings endpoint. With
 * EMBEDDING_MODEL=nomic-ai/nomic-embed-text-v1.5 it produces the same 768-d vectors as Ollama's
 * `nomic-embed-text` (mean pooling + L2 normalisation, same task prefixes), so existing
 * document chunks stay searchable without re-indexing.
 *
 * Weights are downloaded once into MODEL_CACHE_DIR on first use (~520 MB for fp32).
 */
export class LocalEmbedder {
  private readonly logger = new Logger(LocalEmbedder.name);
  private extractor?: Promise<FeatureExtractor>;

  /** Loads (and on first run downloads) the model; concurrent callers share one load. */
  load(): Promise<FeatureExtractor> {
    this.extractor ??= (async () => {
      const started = Date.now();
      // Lazy import: the ONNX runtime is only loaded in processes that actually embed.
      const transformers = await import('@huggingface/transformers');
      transformers.env.cacheDir = resolve(env.MODEL_CACHE_DIR);
      transformers.env.allowLocalModels = false; // ids are Hugging Face repos, never local paths
      const extractor = await transformers.pipeline('feature-extraction', env.EMBEDDING_MODEL, {
        dtype: env.EMBEDDING_LOCAL_DTYPE,
      });
      this.logger.log(
        `Loaded ${env.EMBEDDING_MODEL} (${env.EMBEDDING_LOCAL_DTYPE}) in ${Date.now() - started} ms`,
      );
      return extractor as unknown as FeatureExtractor;
    })().catch((error) => {
      this.extractor = undefined; // allow a later retry (e.g. after a network hiccup)
      throw error;
    });
    return this.extractor;
  }

  async embed(inputs: string[]): Promise<number[][]> {
    const extractor = await this.load();
    const vectors: number[][] = [];
    for (const batch of batchByLength(inputs)) {
      const output = await extractor(batch, { pooling: 'mean', normalize: true });
      vectors.push(...output.tolist());
    }
    return vectors;
  }
}

/**
 * Each model call has a fixed cost of ~0.5 s on CPU, so short texts (the tutor's sentence
 * spans) go in large batches: one call for 40 spans takes ~3 s against ~20 s one at a time.
 * The batch is bounded by total length so peak memory stays that of LOCAL_BATCH_SIZE full chunks.
 */
export function batchByLength(inputs: string[], maxChars = LOCAL_BATCH_SIZE * LOCAL_CHUNK_CHARS): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const input of inputs) {
    if (current.length > 0 && chars + input.length > maxChars) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(input);
    chars += input.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
