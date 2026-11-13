import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SurfaceTheme } from '@prisma/client';
import { z } from 'zod';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildPalette,
  DEFAULT_ACCENT,
  DEFAULT_APP_NAME,
  DEFAULT_SURFACE,
  HEX_COLOR,
  Palette,
  SURFACE_PRESETS,
  SurfacePreset,
} from './palette';

export const MAX_LOGO_BYTES = 512 * 1024;
const MAX_LOGO_SIDE_PX = 4096;
/** Other API instances pick up a change within this time; this one at once. */
const CACHE_MS = 30_000;

const appName = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(40, 'Use at most 40 characters')
  .refine((v) => !/[\p{Cc}\p{Cf}<>]/u.test(v), 'The name cannot contain control characters or < >');
const accentColor = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HEX_COLOR, 'Use a colour like #3ee2d2');

export const updateBrandingSchema = z
  .object({ appName, accentColor, surface: z.nativeEnum(SurfaceTheme) })
  .strict();
export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;

export const previewPaletteSchema = z
  .object({ accent: accentColor, surface: z.nativeEnum(SurfaceTheme).default(SurfaceTheme.MIDNIGHT) })
  .strict();
export type PreviewPaletteInput = z.infer<typeof previewPaletteSchema>;

/** What every page needs to draw the site: public (the login page uses it). */
export interface BrandingView {
  appName: string;
  accentColor: string;
  surface: SurfaceTheme;
  /** Versioned, same-origin URL (served through the web app's /api/v1 proxy), or null. */
  logoUrl: string | null;
  palette: Palette;
  updatedAt: string | null;
}

export interface PdfBrand {
  name: string;
  accent: string;
  accentOnLight: string;
  ink: string;
  panel: string;
  line: string;
  logo: Buffer | null;
}

/** Shown on the admin page; computed once. */
const ACCENT_PRESETS = [
  { label: 'Aqua', color: DEFAULT_ACCENT },
  { label: 'Sky', color: '#38bdf8' },
  { label: 'Indigo', color: '#818cf8' },
  { label: 'Violet', color: '#a78bfa' },
  { label: 'Rose', color: '#fb7185' },
  { label: 'Amber', color: '#fbbf24' },
  { label: 'Emerald', color: '#34d399' },
  { label: 'Lime', color: '#a3e635' },
];

@Injectable()
export class BrandingService {
  private cached?: { view: BrandingView; at: number };
  private cachedLogo?: { version: string; data: Buffer; mimeType: string };

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async get(): Promise<BrandingView> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.view;
    const row = await this.prisma.branding.findUnique({
      where: { id: 1 },
      select: { appName: true, accentColor: true, surface: true, logoUpdatedAt: true, logoMimeType: true, updatedAt: true },
    });
    const accent = row?.accentColor ?? DEFAULT_ACCENT;
    const surface = row?.surface ?? DEFAULT_SURFACE;
    const view: BrandingView = {
      appName: row?.appName ?? DEFAULT_APP_NAME,
      accentColor: accent,
      surface,
      logoUrl: row?.logoUpdatedAt && row.logoMimeType ? `/api/v1/branding/logo?v=${row.logoUpdatedAt.getTime()}` : null,
      palette: buildPalette(accent, surface),
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
    this.cached = { view, at: Date.now() };
    return view;
  }

  options() {
    return {
      accentPresets: ACCENT_PRESETS,
      surfaces: (Object.keys(SURFACE_PRESETS) as SurfacePreset[]).map((id) => ({
        id,
        label: SURFACE_PRESETS[id].label,
        swatch: buildPalette(DEFAULT_ACCENT, id).surface,
      })),
      defaults: { appName: DEFAULT_APP_NAME, accentColor: DEFAULT_ACCENT, surface: DEFAULT_SURFACE },
      maxLogoBytes: MAX_LOGO_BYTES,
    };
  }

  preview(input: PreviewPaletteInput): Palette {
    return buildPalette(input.accent, input.surface);
  }

  async update(actorId: string, input: UpdateBrandingInput, ip?: string): Promise<BrandingView> {
    const before = await this.get();
    await this.prisma.branding.upsert({
      where: { id: 1 },
      create: { id: 1, ...input, updatedById: actorId },
      update: { ...input, updatedById: actorId },
    });
    this.cached = undefined;
    const changed = (Object.keys(input) as (keyof UpdateBrandingInput)[]).filter((k) => before[k] !== input[k]);
    if (changed.length > 0) {
      await this.auditLog.recordAuditEvent({
        actorId,
        action: 'branding.updated',
        resourceType: 'branding',
        metadata: Object.fromEntries(changed.map((k) => [k, { from: before[k], to: input[k] }])),
        ipAddress: ip,
      });
    }
    return this.get();
  }

  async setLogo(actorId: string, file: Express.Multer.File | undefined, ip?: string): Promise<BrandingView> {
    if (!file) throw new BadRequestException('Choose an image file');
    const mimeType = detectLogoType(file.buffer);
    if (!mimeType) {
      throw new BadRequestException(`The logo must be a PNG or JPEG image, at most ${MAX_LOGO_SIDE_PX} pixels on each side.`);
    }
    const current = await this.get();
    const logo = Uint8Array.from(file.buffer); // Prisma Bytes: a plain Uint8Array copy
    await this.prisma.branding.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        appName: current.appName,
        accentColor: current.accentColor,
        surface: current.surface,
        logo,
        logoMimeType: mimeType,
        logoUpdatedAt: new Date(),
        updatedById: actorId,
      },
      update: { logo, logoMimeType: mimeType, logoUpdatedAt: new Date(), updatedById: actorId },
    });
    this.cached = undefined;
    this.cachedLogo = undefined;
    await this.auditLog.recordAuditEvent({
      actorId,
      action: 'branding.logo_updated',
      resourceType: 'branding',
      metadata: { bytes: file.buffer.length, type: mimeType },
      ipAddress: ip,
    });
    return this.get();
  }

  async removeLogo(actorId: string, ip?: string): Promise<BrandingView> {
    const { count } = await this.prisma.branding.updateMany({
      where: { id: 1, logoUpdatedAt: { not: null } },
      data: { logo: null, logoMimeType: null, logoUpdatedAt: null, updatedById: actorId },
    });
    if (count === 0) throw new NotFoundException('No logo is set');
    this.cached = undefined;
    this.cachedLogo = undefined;
    await this.auditLog.recordAuditEvent({ actorId, action: 'branding.logo_removed', resourceType: 'branding', ipAddress: ip });
    return this.get();
  }

  /** The current logo; `version` is the timestamp in its URL. */
  async logo(): Promise<{ version: string; data: Buffer; mimeType: string } | null> {
    const view = await this.get();
    if (!view.logoUrl) return null;
    const version = new URL(view.logoUrl, 'http://x').searchParams.get('v') ?? '';
    if (this.cachedLogo?.version === version) return this.cachedLogo;
    const row = await this.prisma.branding.findUnique({ where: { id: 1 }, select: { logo: true, logoMimeType: true } });
    if (!row?.logo || !row.logoMimeType) return null;
    this.cachedLogo = { version, data: Buffer.from(row.logo), mimeType: row.logoMimeType };
    return this.cachedLogo;
  }

  /** Name, colours and logo for generated PDFs (certificates, score cards, flashcards). */
  async pdfBrand(): Promise<PdfBrand> {
    const view = await this.get();
    const logo = await this.logo().catch(() => null);
    return {
      name: view.appName,
      accent: view.palette.accent[400],
      accentOnLight: view.palette.accentOnLight,
      ink: view.palette.surface[900],
      panel: view.palette.surface[800],
      line: view.palette.surface[600],
      logo: logo?.data ?? null,
    };
  }
}

/**
 * PNG or JPEG by magic bytes (the client's MIME type and file name are ignored), within the
 * size limit on each side. SVG is refused: it can carry script.
 */
export function detectLogoType(buf: Buffer): 'image/png' | 'image/jpeg' | null {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return width > 0 && height > 0 && width <= MAX_LOGO_SIDE_PX && height <= MAX_LOGO_SIDE_PX ? 'image/png' : null;
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const size = jpegSize(buf);
    return size && size.width <= MAX_LOGO_SIDE_PX && size.height <= MAX_LOGO_SIDE_PX ? 'image/jpeg' : null;
  }
  return null;
}

/** Reads the frame header (SOF0-SOF15, except DHT/JPG/DAC) for the image size. */
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}
