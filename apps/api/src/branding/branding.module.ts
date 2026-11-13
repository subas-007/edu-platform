import {
  Body,
  Controller,
  Delete,
  Get,
  Global,
  Ip,
  Module,
  NotFoundException,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  AuthenticatedUser,
  CurrentUser,
  Public,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { ZodValidationPipe, zodBody } from '../common/pipes/zod-validation.pipe';
import { Permission } from '../common/security/permissions';
import {
  BrandingService,
  MAX_LOGO_BYTES,
  PreviewPaletteInput,
  previewPaletteSchema,
  UpdateBrandingInput,
  updateBrandingSchema,
} from './branding.service';

/**
 * The site's name, logo and colour theme. Reading is public (the login page and every page
 * render need it, so it is not rate-limited and is cached); changing it needs branding:manage.
 */
@Controller('branding')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Public()
  @SkipThrottle()
  @Get()
  get() {
    return this.branding.get();
  }

  /** Versioned URL (?v=…), so browsers may keep it for a year; a new logo gets a new URL. */
  @Public()
  @SkipThrottle()
  @Get('logo')
  async logo(@Query('v') version: string | undefined, @Res({ passthrough: true }) res: Response) {
    const logo = await this.branding.logo();
    if (!logo) throw new NotFoundException('No logo is set');
    res.set({
      'Content-Type': logo.mimeType,
      'Cache-Control': version === logo.version ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    return new StreamableFile(logo.data);
  }

  @RequirePermissions(Permission.BrandingManage)
  @Get('options')
  options() {
    return this.branding.options();
  }

  /** The shade scales for a colour choice, so the admin page can preview it before saving. */
  @RequirePermissions(Permission.BrandingManage)
  @Get('palette')
  preview(@Query(new ZodValidationPipe(previewPaletteSchema)) query: PreviewPaletteInput) {
    return this.branding.preview(query);
  }

  @RequirePermissions(Permission.BrandingManage)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Put()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(updateBrandingSchema)) body: UpdateBrandingInput,
    @Ip() ip: string,
  ) {
    return this.branding.update(user.id, body, ip);
  }

  @RequirePermissions(Permission.BrandingManage)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Put('logo')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 0 } }),
  )
  setLogo(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: Express.Multer.File | undefined, @Ip() ip: string) {
    return this.branding.setLogo(user.id, file, ip);
  }

  @RequirePermissions(Permission.BrandingManage)
  @Delete('logo')
  removeLogo(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return this.branding.removeLogo(user.id, ip);
  }
}

@Global()
@Module({
  controllers: [BrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
