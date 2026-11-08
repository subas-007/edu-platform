import { z } from 'zod';

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(256),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

/** Shared password policy for provisioning / password changes. */
export const passwordPolicy = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(256)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), {
    message: 'Password must contain upper-case, lower-case and a digit',
  });
