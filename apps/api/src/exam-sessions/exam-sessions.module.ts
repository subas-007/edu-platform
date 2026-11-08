import { Body, Controller, Get, HttpCode, Module, Param, Post } from '@nestjs/common';
import {
  AuthenticatedOnly,
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { Permission } from '../common/security/permissions';
import { uuidParam } from '../common/validation';
import {
  StartExamSessionInput,
  startExamSessionSchema,
  SubmitAnswerInput,
  submitAnswerSchema,
} from './exam-sessions.schemas';
import { ExamSessionsService } from './exam-sessions.service';

@Controller('exam-sessions')
export class ExamSessionsController {
  constructor(private readonly examSessionsService: ExamSessionsService) {}

  @RequirePermissions(Permission.ExamsTake)
  @Post()
  startExamSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(startExamSessionSchema)) body: StartExamSessionInput,
  ) {
    return this.examSessionsService.startExamSession(user, body);
  }

  @AuthenticatedOnly() // owner, or staff with ExamResultsReadAll — enforced in service
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

@Module({ controllers: [ExamSessionsController], providers: [ExamSessionsService] })
export class ExamSessionsModule {}
