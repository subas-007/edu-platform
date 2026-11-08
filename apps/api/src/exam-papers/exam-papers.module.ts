import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { ZodValidationPipe, zodBody } from '../common/pipes/zod-validation.pipe';
import { Permission } from '../common/security/permissions';
import { uuidParam } from '../common/validation';
import { ExamSessionsModule } from '../exam-sessions/exam-sessions.module';
import { ExamSessionsService } from '../exam-sessions/exam-sessions.service';
import {
  CreateExamPaperInput,
  createExamPaperSchema,
  ListExamPapersQuery,
  listExamPapersQuerySchema,
  UpdateExamPaperInput,
  updateExamPaperSchema,
} from './exam-papers.schemas';
import { ExamPapersService } from './exam-papers.service';

/**
 * Exam programs. Staff assemble ad-hoc question papers from the question bank;
 * students enroll in published programs and sit them as timed exams.
 * Student routes are declared first so `available` is not parsed as an :id.
 */
@Controller('exam-papers')
export class ExamPapersController {
  constructor(
    private readonly papers: ExamPapersService,
    private readonly sessions: ExamSessionsService,
  ) {}

  @RequirePermissions(Permission.ExamsTake)
  @Get('available')
  listAvailablePrograms(@CurrentUser() user: AuthenticatedUser) {
    return this.papers.listAvailablePrograms(user);
  }

  @RequirePermissions(Permission.ExamsTake)
  @Post(':paperId/enrollments')
  @HttpCode(200)
  enroll(@CurrentUser() user: AuthenticatedUser, @Param('paperId', uuidParam) paperId: string) {
    return this.papers.enroll(user, paperId);
  }

  @RequirePermissions(Permission.ExamsTake)
  @Post(':paperId/sessions')
  startAttempt(@CurrentUser() user: AuthenticatedUser, @Param('paperId', uuidParam) paperId: string) {
    return this.sessions.startPaperSession(user, paperId);
  }

  @RequirePermissions(Permission.ExamPapersManage)
  @Get()
  listPapers(@Query(new ZodValidationPipe(listExamPapersQuerySchema)) query: ListExamPapersQuery) {
    return this.papers.listPapers(query);
  }

  @RequirePermissions(Permission.ExamPapersManage)
  @Post()
  createPaper(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(createExamPaperSchema)) body: CreateExamPaperInput,
  ) {
    return this.papers.createPaper(actor, body);
  }

  @RequirePermissions(Permission.ExamPapersManage)
  @Get(':paperId')
  getPaper(@Param('paperId', uuidParam) paperId: string) {
    return this.papers.getPaperDetail(paperId);
  }

  @RequirePermissions(Permission.ExamPapersManage)
  @Patch(':paperId')
  updatePaper(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('paperId', uuidParam) paperId: string,
    @Body(zodBody(updateExamPaperSchema)) body: UpdateExamPaperInput,
  ) {
    return this.papers.updatePaper(actor, paperId, body);
  }

  @RequirePermissions(Permission.ExamPapersManage)
  @Delete(':paperId')
  @HttpCode(204)
  deletePaper(@CurrentUser() actor: AuthenticatedUser, @Param('paperId', uuidParam) paperId: string) {
    return this.papers.deletePaper(actor, paperId);
  }
}

@Module({
  imports: [ExamSessionsModule],
  controllers: [ExamPapersController],
  providers: [ExamPapersService],
})
export class ExamPapersModule {}
