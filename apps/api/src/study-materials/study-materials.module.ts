import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ASSET_GENERATION_QUEUE, MATERIAL_INGESTION_QUEUE } from '../queues/queue-names';
import { MaterialAccessPolicy } from './material-access.policy';
import { MaterialStorageService } from './material-storage.service';
import { StudyMaterialsController } from './study-materials.controller';
import { StudyMaterialsRepository } from './study-materials.repository';
import { StudyMaterialsService } from './study-materials.service';

/** Global so the access policy / storage can be reused by tutor, exams and workers. */
@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: MATERIAL_INGESTION_QUEUE }, { name: ASSET_GENERATION_QUEUE }),
  ],
  controllers: [StudyMaterialsController],
  providers: [
    StudyMaterialsService,
    StudyMaterialsRepository,
    MaterialAccessPolicy,
    MaterialStorageService,
  ],
  exports: [MaterialAccessPolicy, MaterialStorageService],
})
export class StudyMaterialsModule {}
