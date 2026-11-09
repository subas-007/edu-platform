import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LlmModule } from './ai/llm.service';
import { AssetGenerationProcessor } from './generation/asset-generation.processor';
import { PipelineRecoveryService } from './generation/pipeline-recovery.service';
import { MaterialIngestionProcessor } from './ingestion/material-ingestion.processor';
import { MaterialReuseService } from './ingestion/material-reuse.service';
import { PrismaModule } from './prisma/prisma.service';
import {
  ASSET_GENERATION_QUEUE,
  buildRedisConnection,
  MATERIAL_INGESTION_QUEUE,
} from './queues/queue-names';
import { MaterialStorageService } from './study-materials/material-storage.service';

/**
 * Separate process for CPU/IO-heavy work (OCR, parsing, embeddings, LLM generation).
 * It exposes no HTTP surface and can be scaled / sandboxed independently.
 */
@Module({
  imports: [
    BullModule.forRoot({ connection: buildRedisConnection() }),
    BullModule.registerQueue({ name: ASSET_GENERATION_QUEUE }, { name: MATERIAL_INGESTION_QUEUE }),
    PrismaModule,
    LlmModule,
  ],
  providers: [
    MaterialStorageService,
    MaterialReuseService,
    MaterialIngestionProcessor,
    AssetGenerationProcessor,
    PipelineRecoveryService,
  ],
})
export class WorkerModule {}
