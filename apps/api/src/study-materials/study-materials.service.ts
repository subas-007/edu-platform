import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MaterialFileType, MaterialStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditLogService } from '../audit/audit-log.service';
import { AuthenticatedUser } from '../common/decorators/access.decorators';
import {
  DEFAULT_JOB_OPTIONS,
  MATERIAL_INGESTION_QUEUE,
  MaterialIngestionJob,
} from '../queues/queue-names';
import { detectUploadFileType, FILE_EXTENSIONS } from './file-signature';
import { MaterialAccessPolicy } from './material-access.policy';
import { MaterialStorageService } from './material-storage.service';
import {
  CreateUrlMaterialInput,
  ListMaterialsQuery,
  UpdateMaterialVisibilityInput,
} from './study-materials.schemas';
import { StudyMaterialsRepository } from './study-materials.repository';

@Injectable()
export class StudyMaterialsService {
  constructor(
    private readonly materialsRepository: StudyMaterialsRepository,
    private readonly accessPolicy: MaterialAccessPolicy,
    private readonly storage: MaterialStorageService,
    private readonly auditLog: AuditLogService,
    @InjectQueue(MATERIAL_INGESTION_QUEUE)
    private readonly ingestionQueue: Queue<MaterialIngestionJob>,
  ) {}

  listMaterials(user: AuthenticatedUser, query: ListMaterialsQuery) {
    const where = {
      AND: [
        this.accessPolicy.buildReadableMaterialsFilter(user),
        query.status ? { status: query.status } : {},
        query.mine ? { uploadedById: user.id } : {},
      ],
    };
    return this.materialsRepository.findMaterialsPage(where, query.page, query.pageSize);
  }

  async getMaterial(user: AuthenticatedUser, materialId: string) {
    await this.accessPolicy.getReadableMaterialOrThrow(user, materialId);
    return this.materialsRepository.findMaterialSummary(materialId);
  }

  async uploadMaterialFile(user: AuthenticatedUser, title: string, file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('A file is required');
    const fileType = detectUploadFileType(file.buffer);
    if (!fileType) {
      throw new BadRequestException('Unsupported or malformed file. Allowed: PDF, DOCX, PNG, JPEG');
    }
    const storageKey = await this.storage.storeMaterialFile(file.buffer, FILE_EXTENSIONS[fileType]);
    return this.createAndEnqueueMaterial(user, { title, fileUrl: storageKey, fileType });
  }

  submitMaterialUrl(user: AuthenticatedUser, input: CreateUrlMaterialInput) {
    // Network-level SSRF checks happen at fetch time in the worker (DNS can change).
    return this.createAndEnqueueMaterial(user, {
      title: input.title,
      fileUrl: input.url,
      fileType: MaterialFileType.URL,
    });
  }

  async updateMaterialVisibility(
    user: AuthenticatedUser,
    materialId: string,
    input: UpdateMaterialVisibilityInput,
  ) {
    const material = await this.accessPolicy.getReadableMaterialOrThrow(user, materialId);
    if (material.status !== MaterialStatus.READY) {
      throw new ConflictException('Only fully processed materials can be published');
    }
    const updated = await this.materialsRepository.updateMaterial(materialId, {
      visibility: input.visibility,
    });
    await this.auditLog.recordAuditEvent({
      actorId: user.id,
      action: `material.visibility_${input.visibility.toLowerCase()}`,
      resourceType: 'material',
      resourceId: materialId,
    });
    return updated;
  }

  async deleteMaterial(user: AuthenticatedUser, materialId: string) {
    const material = await this.accessPolicy.getReadableMaterialOrThrow(user, materialId);
    if (!this.accessPolicy.canDeleteMaterial(user, material)) throw new NotFoundException();
    await this.materialsRepository.deleteMaterial(materialId);
    if (material.fileType !== MaterialFileType.URL) {
      await this.storage.deleteMaterialFile(material.fileUrl);
    }
    await this.auditLog.recordAuditEvent({
      actorId: user.id,
      action: 'material.deleted',
      resourceType: 'material',
      resourceId: materialId,
      metadata: { title: material.title, ownerId: material.uploadedById },
    });
  }

  async listFlashcards(user: AuthenticatedUser, materialId: string) {
    await this.accessPolicy.getReadableMaterialOrThrow(user, materialId);
    return this.materialsRepository.findFlashcardsForMaterial(materialId);
  }

  private async createAndEnqueueMaterial(
    user: AuthenticatedUser,
    data: { title: string; fileUrl: string; fileType: MaterialFileType },
  ) {
    const material = await this.materialsRepository.createMaterial({
      ...data,
      uploadedById: user.id,
    });
    await this.ingestionQueue.add(
      'ingest-material',
      { materialId: material.id },
      { ...DEFAULT_JOB_OPTIONS, jobId: `ingest-${material.id}` },
    );
    await this.auditLog.recordAuditEvent({
      actorId: user.id,
      action: 'material.uploaded',
      resourceType: 'material',
      resourceId: material.id,
      metadata: { fileType: data.fileType },
    });
    return material;
  }
}
