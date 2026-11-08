import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/**
 * Validates and *replaces* input with the parsed value, so handlers only ever
 * see whitelisted, typed data. Schemas use .strict() to reject unknown keys
 * (blocks mass-assignment such as `{ "role": "ADMIN" }`).
 */
@Injectable()
export class ZodValidationPipe<TSchema extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.infer<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}

export const zodBody = <T extends ZodTypeAny>(schema: T) => new ZodValidationPipe(schema);
