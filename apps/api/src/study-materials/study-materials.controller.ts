import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import {
  AuthenticatedOnly,
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { ZodValidationPipe, zodBody } from '../common/pipes/zod-validation.pipe';
import { Permission } from '../common/security/permissions';
import { uuidParam } from '../common/validation';
import { env } from '../config/env';
import {
  CreateUrlMaterialInput,
  createUrlMaterialSchema,
  ExportFlashcardsQuery,
  exportFlashcardsQuerySchema,
  ListMaterialsQuery,
  listMaterialsQuerySchema,
  UpdateMaterialVisibilityInput,
  updateMaterialVisibilitySchema,
  uploadMaterialFieldsSchema,
} from './study-materials.schemas';
import { StudyMaterialsService } from './study-materials.service';

@Controller('study-materials')
export class StudyMaterialsController {
  constructor(private readonly materialsService: StudyMaterialsService) {}

  @AuthenticatedOnly() // object-level filtering happens in MaterialAccessPolicy
  @Get()
  listMaterials(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listMaterialsQuerySchema)) query: ListMaterialsQuery,
  ) {
    return this.materialsService.listMaterials(user, query);
  }

  @AuthenticatedOnly()
  @Get(':materialId')
  getMaterial(@CurrentUser() user: AuthenticatedUser, @Param('materialId', uuidParam) id: string) {
    return this.materialsService.getMaterial(user, id);
  }

  @AuthenticatedOnly()
  @Get(':materialId/flashcards')
  listFlashcards(@CurrentUser() user: AuthenticatedUser, @Param('materialId', uuidParam) id: string) {
    return this.materialsService.listFlashcards(user, id);
  }

  @AuthenticatedOnly()
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // PDF rendering is CPU work
  @Get(':materialId/flashcards/export')
  async exportFlashcards(
    @CurrentUser() user: AuthenticatedUser,
    @Param('materialId', uuidParam) id: string,
    @Query(new ZodValidationPipe(exportFlashcardsQuerySchema)) query: ExportFlashcardsQuery,
  ) {
    const file = await this.materialsService.exportFlashcards(user, id, query);
    return new StreamableFile(file.buffer, {
      type: file.type,
      disposition: `attachment; filename="${file.filename}"`,
      length: file.buffer.length,
    });
  }

  @RequirePermissions(Permission.MaterialsUpload)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('files')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 2, fieldSize: 1024 },
    }),
  )
  uploadMaterialFile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(uploadMaterialFieldsSchema)) body: { title: string },
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.materialsService.uploadMaterialFile(user, body.title, file);
  }

  @RequirePermissions(Permission.MaterialsUpload)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('urls')
  submitMaterialUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createUrlMaterialSchema)) body: CreateUrlMaterialInput,
  ) {
    return this.materialsService.submitMaterialUrl(user, body);
  }

  @RequirePermissions(Permission.MaterialsPublish)
  @Patch(':materialId/visibility')
  updateMaterialVisibility(
    @CurrentUser() user: AuthenticatedUser,
    @Param('materialId', uuidParam) id: string,
    @Body(zodBody(updateMaterialVisibilitySchema)) body: UpdateMaterialVisibilityInput,
  ) {
    return this.materialsService.updateMaterialVisibility(user, id, body);
  }

  @AuthenticatedOnly() // owner-or-moderator check in service
  @Delete(':materialId')
  @HttpCode(204)
  deleteMaterial(@CurrentUser() user: AuthenticatedUser, @Param('materialId', uuidParam) id: string) {
    return this.materialsService.deleteMaterial(user, id);
  }
}
