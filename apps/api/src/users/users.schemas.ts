import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { passwordPolicy } from '../auth/auth.schemas';

export const provisionUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.nativeEnum(UserRole),
    initialPassword: passwordPolicy,
  })
  .strict();
export type ProvisionUserInput = z.infer<typeof provisionUserSchema>;

export const updateUserSchema = z
  .object({
    role: z.nativeEnum(UserRole).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.role !== undefined || v.isActive !== undefined, 'No changes supplied');
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const listUsersQuerySchema = z
  .object({
    role: z.nativeEnum(UserRole).optional(),
    search: z.string().trim().max(254).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
