import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { GenerationStatus, MaterialStatus } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  ASSET_GENERATION_QUEUE,
  AssetGenerationJob,
  enqueueUniqueJob,
  generationJobId,
  ingestionJobId,
  MATERIAL_INGESTION_QUEUE,
  MaterialIngestionJob,
} from '../queues/queue-names';
import { GENERATION_FAILED_MESSAGE } from './asset-generation.processor';

const SWEEP_INTERVAL_MS = 2 * 60_000;
/** Don't race the API, which enqueues right after creating the row. */
const MIN_AGE_MS = 60_000;
const INGESTION_FAILED_MESSAGE = 'Processing failed. Please retry.';

/**
 * Self-healing for the material pipeline. Materials can be left half-done when the worker
 * is restarted or crashes mid-job (BullMQ then fails the job as "stalled") or when Redis
 * lost a job. On start-up and every couple of minutes this:
 *  - re-queues work whose job is missing or died from a stall (resuming saved progress);
 *  - marks work whose job genuinely failed as FAILED, so the UI offers Retry instead of
 *    showing "generating…" forever.
 */
@Injectable()
export class PipelineRecoveryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PipelineRecoveryService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(MATERIAL_INGESTION_QUEUE) private readonly ingestionQueue: Queue<MaterialIngestionJob>,
    @InjectQueue(ASSET_GENERATION_QUEUE) private readonly generationQueue: Queue<AssetGenerationJob>,
  ) {}

  onApplicationBootstrap() {
    setTimeout(() => void this.sweep(), 5_000).unref();
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - MIN_AGE_MS);
      const [unfinishedIngestion, unfinishedGeneration] = await Promise.all([
        this.prisma.material.findMany({
          where: { status: { in: [MaterialStatus.QUEUED, MaterialStatus.PROCESSING] }, updatedAt: { lt: cutoff } },
          select: { id: true },
          take: 100,
        }),
        this.prisma.material.findMany({
          where: {
            status: MaterialStatus.READY,
            generationStatus: { in: [GenerationStatus.PENDING, GenerationStatus.GENERATING] },
            updatedAt: { lt: cutoff },
          },
          select: { id: true },
          take: 100,
        }),
      ]);

      for (const { id } of unfinishedIngestion) {
        const action = await this.recover(this.ingestionQueue, ingestionJobId(id), 'ingest-material', { materialId: id });
        if (action === 'failed') {
          await this.prisma.material.updateMany({
            where: { id, status: { in: [MaterialStatus.QUEUED, MaterialStatus.PROCESSING] } },
            data: { status: MaterialStatus.FAILED, failureReason: INGESTION_FAILED_MESSAGE },
          });
        }
        if (action !== 'alive') this.logger.log(`Material ${id}: ingestion ${action}`);
      }

      for (const { id } of unfinishedGeneration) {
        const action = await this.recover(this.generationQueue, generationJobId(id), 'generate-assets', {
          materialId: id,
        });
        if (action === 'failed') {
          await this.prisma.material.updateMany({
            where: { id, generationStatus: { in: [GenerationStatus.PENDING, GenerationStatus.GENERATING] } },
            data: { generationStatus: GenerationStatus.FAILED, generationError: GENERATION_FAILED_MESSAGE },
          });
        }
        if (action !== 'alive') this.logger.log(`Material ${id}: generation ${action}`);
      }
    } catch (error) {
      this.logger.warn(`Pipeline recovery sweep failed: ${error}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * alive    – job is queued/running, nothing to do
   * requeued – job was missing, or was killed by a worker restart (stall); progress kept
   * failed   – job failed for a real reason (its own handler normally records this)
   */
  private async recover<T extends { materialId: string }>(
    queue: Queue<T>,
    jobId: string,
    name: string,
    data: T,
  ): Promise<'alive' | 'requeued' | 'failed'> {
    const job = (await queue.getJob(jobId)) as Job<T> | undefined;
    const state = job ? await job.getState() : 'missing';
    if (['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'].includes(state)) return 'alive';
    if (state === 'failed' && !/stalled/i.test(job?.failedReason ?? '')) return 'failed';

    // missing, completed-but-unfinished, unknown, or stalled: queue again, carrying saved progress.
    const carried = { ...data, ...(job?.data ?? {}) };
    await enqueueUniqueJob(queue, name, carried, jobId);
    return 'requeued';
  }
}
