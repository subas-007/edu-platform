import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AuthenticatedOnly,
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { ZodValidationPipe, zodBody } from '../common/pipes/zod-validation.pipe';
import { Permission } from '../common/security/permissions';
import { uuidParam } from '../common/validation';
import {
  ListMySessionsQuery,
  listMySessionsQuerySchema,
  StartExamSessionInput,
  startExamSessionSchema,
  SubmitAnswerInput,
  submitAnswerSchema,
} from './exam-sessions.schemas';
import { ExamSessionsService } from './exam-sessions.service';

function pdfFile(file: { buffer: Buffer; filename: string }) {
  return new StreamableFile(file.buffer, {
    type: 'application/pdf',
    disposition: `attachment; filename="${file.filename}"`,
    length: file.buffer.length,
  });
}

@Controller('exam-sessions')
export class ExamSessionsController {
  constructor(private readonly examSessionsService: ExamSessionsService) {}

  @RequirePermissions(Permission.ExamsTake)
  @Get()
  listMySessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listMySessionsQuerySchema)) query: ListMySessionsQuery,
  ) {
    return this.examSessionsService.listMySessions(user, query);
  }

  @RequirePermissions(Permission.ExamsTake)
  @Post()
  startExamSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(startExamSessionSchema)) body: StartExamSessionInput,
  ) {
    return this.examSessionsService.startExamSession(user, body);
  }

  @AuthenticatedOnly() // owner, or staff with ExamResultsReadAll; enforced in service
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // PDF rendering is CPU work
  @Get(':sessionId/scorecard')
  async downloadScorecard(@CurrentUser() user: AuthenticatedUser, @Param('sessionId', uuidParam) id: string) {
    return pdfFile(await this.examSessionsService.renderScorecard(user, id));
  }

  @AuthenticatedOnly() // owner, or staff with ExamResultsReadAll; enforced in service
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':sessionId/certificate')
  async downloadCertificate(@CurrentUser() user: AuthenticatedUser, @Param('sessionId', uuidParam) id: string) {
    return pdfFile(await this.examSessionsService.renderCertificate(user, id));
  }

  @AuthenticatedOnly() // owner, or staff with ExamResultsReadAll; enforced in service
  @Get(':sessionId')
  getExamSession(@CurrentUser() user: AuthenticatedUser, @Param('sessionId', uuidParam) id: string) {
    return this.examSessionsService.getExamSession(user, id);
  }

  @RequirePermissions(Permission.ExamsTake)
  @Post(':sessionId/answers')
  @HttpCode(200)
  recordAnswer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', uuidParam) id: string,
    @Body(zodBody(submitAnswerSchema)) body: SubmitAnswerInput,
  ) {
    return this.examSessionsService.recordAnswer(user, id, body);
  }

  @RequirePermissions(Permission.ExamsTake)
  @Post(':sessionId/submissions')
  @HttpCode(200)
  submitExamSession(@CurrentUser() user: AuthenticatedUser, @Param('sessionId', uuidParam) id: string) {
    return this.examSessionsService.evaluateExamSubmission(user, id);
  }
}

@Module({
  controllers: [ExamSessionsController],
  providers: [ExamSessionsService],
  exports: [ExamSessionsService],
})
export class ExamSessionsModule {}
