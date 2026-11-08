import { env } from '../config/env';

export const MATERIAL_INGESTION_QUEUE = 'material-ingestion';
export const ASSET_GENERATION_QUEUE = 'asset-generation';

export interface MaterialIngestionJob {
  materialId: string;
}
export interface AssetGenerationJob {
  materialId: string;
}

export function buildRedisConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}

export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};
