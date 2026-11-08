import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence-in-depth on top of SameSite=Strict cookies: every state-changing
 * request must carry an Origin header from the allow-list.
 */
@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin || !env.CORS_ORIGINS.includes(origin)) {
      throw new ForbiddenException('Cross-origin request rejected');
    }
    next();
  }
}
