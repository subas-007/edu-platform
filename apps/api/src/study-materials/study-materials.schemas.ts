import { MaterialStatus, MaterialVisibility } from '@prisma/client';
import { z } from 'zod';
import { sanitizedText } from '../common/validation';

export const materialTitleSchema = sanitizedText(200);

export const publicHttpUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password &&
      (url.port === '' || url.port === '80' || url.port === '443')
    );
  }, 'Only http(s) URLs on standard ports without credentials are allowed');

export const createUrlMaterialSchema = z
  .object({ title: materialTitleSchema, url: publicHttpUrlSchema })
  .strict();
export type CreateUrlMaterialInput = z.infer<typeof createUrlMaterialSchema>;

export const uploadMaterialFieldsSchema = z.object({ title: materialTitleSchema }).strict();

export const updateMaterialVisibilitySchema = z
  .object({ visibility: z.nativeEnum(MaterialVisibility) })
  .strict();
export type UpdateMaterialVisibilityInput = z.infer<typeof updateMaterialVisibilitySchema>;

export const exportFlashcardsQuerySchema = z
  .object({ format: z.enum(['csv', 'pdf']).default('pdf') })
  .strict();
export type ExportFlashcardsQuery = z.infer<typeof exportFlashcardsQuerySchema>;

export const listMaterialsQuerySchema = z
  .object({
    status: z.nativeEnum(MaterialStatus).optional(),
    mine: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    search: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type ListMaterialsQuery = z.infer<typeof listMaterialsQuerySchema>;
