import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GenerationStatus, MaterialFileType, MaterialStatus, UserRole } from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditLogService } from '../audit/audit-log.service';
import { AuthenticatedUser } from '../common/decorators/access.decorators';
import {
  renderFlashcardsCsv,
  renderFlashcardsPdf,
  toFilenameStem,
} from '../documents/pdf-documents';
import {
  ASSET_GENERATION_QUEUE,
  AssetGenerationJob,
  enqueueUniqueJob,
  generationJobId,
  ingestionJobId,
  MATERIAL_INGESTION_QUEUE,
  MaterialIngestionJob,
} from '../queues/queue-names';
import { detectUploadFileType, FILE_EXTENSIONS } from './file-signature';
import { MaterialAccessPolicy } from './material-access.policy';
import { MaterialStorageService } from './material-storage.service';
import {
  CreateUrlMaterialInput,
  ExportFlashcardsQuery,
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
    @InjectQueue(ASSET_GENERATION_QUEUE)
    private readonly generationQueue: Queue<AssetGenerationJob>,
  ) {}

  listMaterials(user: AuthenticatedUser, query: ListMaterialsQuery) {
    const where = {
      AND: [
        this.accessPolicy.buildReadableMaterialsFilter(user),
        query.status ? { status: query.status } : {},
        query.mine ? { uploadedById: user.id } : {},
        query.search ? { title: { contains: query.search, mode: 'insensitive' as const } } : {},
      ],
    };
    return this.materialsRepository.findMaterialsPage(
      where,
      query.page,
      query.pageSize,
      user.role === UserRole.STUDENT,
    );
  }

  async getMaterial(user: AuthenticatedUser, materialId: string) {
    await this.accessPolicy.getReadableMaterialOrThrow(user, materialId);
    return this.materialsRepository.findMaterialSummary(materialId, user.role === UserRole.STUDENT);
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

  /**
   * FAILED material → re-run processing from the stored file/URL.
   * READY material whose generation FAILED → re-run flashcard/question/roadmap generation
   * (resuming any batches a stalled job already saved).
   */
  async retryMaterial(user: AuthenticatedUser, materialId: string) {
    const material = await this.accessPolicy.getReadableMaterialOrThrow(user, materialId);
    if (!this.accessPolicy.canDeleteMaterial(user, material)) throw new NotFoundException();

    let stage: 'processing' | 'generation';
    if (material.status === MaterialStatus.FAILED) {
      stage = 'processing';
      await this.materialsRepository.updateMaterial(materialId, {
        status: MaterialStatus.QUEUED,
        failureReason: null,
      });
      await enqueueUniqueJob(this.ingestionQueue, 'ingest-material', { materialId }, ingestionJobId(materialId));
    } else if (
      material.status === MaterialStatus.READY &&
      material.generationStatus === GenerationStatus.FAILED
    ) {
      stage = 'generation';
      const previous = await this.generationQueue.getJob(generationJobId(materialId));
      await this.materialsRepository.updateMaterial(materialId, {
        generationStatus: GenerationStatus.PENDING,
        generationProgress: 0,
        generationError: null,
      });
      await enqueueUniqueJob(
        this.generationQueue,
        'generate-assets',
        { materialId, completedBatches: previous?.data.completedBatches ?? [] },
        generationJobId(materialId),
      );
    } else {
      throw new ConflictException('Nothing to retry: this material is processing or already complete');
    }

    await this.auditLog.recordAuditEvent({
      actorId: user.id,
      action: `material.retry_${stage}`,
      resourceType: 'material',
      resourceId: materialId,
    });
    return this.materialsRepository.findMaterialSummary(materialId, user.role === UserRole.STUDENT);
  }

  async listFlashcards(user: AuthenticatedUser, materialId: string) {
    await this.accessPolicy.getReadableMaterialOrThrow(user, materialId);
    return this.materialsRepository.findFlashcardsForMaterial(materialId);
  }

  /** Downloadable deck: CSV (Anki/Quizlet/Excel import) or a printable PDF. */
  async exportFlashcards(user: AuthenticatedUser, materialId: string, query: ExportFlashcardsQuery) {
    const material = await this.accessPolicy.getReadableMaterialOrThrow(user, materialId);
    const cards = await this.materialsRepository.findFlashcardsForMaterial(materialId);
    if (cards.length === 0) throw new NotFoundException('No flashcards have been generated yet');
    const stem = `${toFilenameStem(material.title)}-flashcards`;
    return query.format === 'csv'
      ? { buffer: renderFlashcardsCsv(cards), type: 'text/csv; charset=utf-8', filename: `${stem}.csv` }
      : { buffer: await renderFlashcardsPdf(material.title, cards), type: 'application/pdf', filename: `${stem}.pdf` };
  }

  private async createAndEnqueueMaterial(
    user: AuthenticatedUser,
    data: { title: string; fileUrl: string; fileType: MaterialFileType },
  ) {
    const material = await this.materialsRepository.createMaterial({
      ...data,
      uploadedById: user.id,
    });
    await enqueueUniqueJob(
      this.ingestionQueue,
      'ingest-material',
      { materialId: material.id },
      ingestionJobId(material.id),
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
