import type { Queue } from 'bullmq';
import { env } from '../config/env';

export const MATERIAL_INGESTION_QUEUE = 'material-ingestion';
export const ASSET_GENERATION_QUEUE = 'asset-generation';

export interface MaterialIngestionJob {
  materialId: string;
}
export interface AssetGenerationJob {
  materialId: string;
  /** Batch indexes already persisted: a restarted/retried job resumes instead of starting over. */
  completedBatches?: number[];
}

export const ingestionJobId = (materialId: string) => `ingest-${materialId}`;
export const generationJobId = (materialId: string) => `generate-${materialId}`;

const LIVE_JOB_STATES = new Set(['active', 'waiting', 'delayed', 'prioritized', 'waiting-children']);

/**
 * Adds a job under a fixed id. BullMQ silently ignores add() when a job with the same id
 * still exists (e.g. an old failed one), so a finished job is removed first. Returns false
 * when the job is already queued or running.
 */
export async function enqueueUniqueJob<T>(queue: Queue<T>, name: string, data: T, jobId: string) {
  const existing = await queue.getJob(jobId);
  if (existing) {
    if (LIVE_JOB_STATES.has(await existing.getState())) return false;
    await existing.remove();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (queue as Queue<any>).add(name, data, { ...DEFAULT_JOB_OPTIONS, jobId });
  return true;
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
