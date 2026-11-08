import { ParseUUIDPipe } from '@nestjs/common';
import { z } from 'zod';

export const uuidParam = new ParseUUIDPipe({ version: '4' });

/** Strips C0/C1 control characters (except \n and \t) and trims. */
export const sanitizedText = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '').trim())
    .pipe(z.string().min(1).max(max));

export const paginationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
