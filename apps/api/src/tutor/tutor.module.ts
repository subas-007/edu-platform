import { Body, Controller, HttpCode, HttpException, Logger, Module, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { Permission } from '../common/security/permissions';
import { TutorRetrievalRepository } from './tutor-retrieval.repository';
import { TutorQueryInput, tutorQuerySchema, TutorService } from './tutor.service';

/** Keeps idle proxies from closing the stream while the model reads the prompt. */
const KEEPALIVE_MS = 15_000;

@Controller('tutor')
export class TutorController {
  private readonly logger = new Logger(TutorController.name);

  constructor(private readonly tutorService: TutorService) {}

  @RequirePermissions(Permission.TutorUse)
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // LLM cost / abuse control
  @Post('queries')
  @HttpCode(200)
  askTutorQuestion(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(tutorQuerySchema)) body: TutorQueryInput,
  ) {
    return this.tutorService.answerStudentQuestion(user, body);
  }

  /** Loads the local model back into memory before the student's first question (fire-and-forget). */
  @RequirePermissions(Permission.TutorUse)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('warmup')
  @HttpCode(202)
  warmUpModel(@CurrentUser() user: AuthenticatedUser) {
    return this.tutorService.warmUp(user);
  }

  /**
   * Same answer as POST /tutor/queries, streamed as server-sent events: what the tutor is
   * doing (searching, choosing passages, the model reading them, writing), the sources,
   * then the answer word by word. Closing the connection cancels the model request.
   * Each event is `data: <json>`; see TutorEvent for the shapes, plus `{type:"error"}`.
   */
  @RequirePermissions(Permission.TutorUse)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('queries/stream')
  async streamTutorAnswer(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(tutorQuerySchema)) body: TutorQueryInput,
    @Res() res: Response,
  ): Promise<void> {
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform', // no-transform: proxies must not compress (buffer) it
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort(); // the student stopped or left
    });
    const send = (event: object) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const keepalive = setInterval(() => !res.writableEnded && res.write(': keepalive\n\n'), KEEPALIVE_MS);

    try {
      for await (const event of this.tutorService.streamStudentAnswer(user, body, controller.signal)) {
        send(event);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const status = error instanceof HttpException ? error.getStatus() : 500;
        if (status >= 500 && !(error instanceof HttpException)) {
          this.logger.error('Tutor stream failed', error as Error);
        }
        send({
          type: 'error',
          status,
          message: error instanceof HttpException ? error.message : 'Sorry, the tutor could not answer that.',
        });
      }
    } finally {
      clearInterval(keepalive);
      res.end();
    }
  }
}

@Module({
  controllers: [TutorController],
  providers: [TutorService, TutorRetrievalRepository],
})
export class TutorModule {}
