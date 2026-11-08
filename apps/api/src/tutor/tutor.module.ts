import { Body, Controller, HttpCode, Module, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { Permission } from '../common/security/permissions';
import { TutorRetrievalRepository } from './tutor-retrieval.repository';
import { TutorQueryInput, tutorQuerySchema, TutorService } from './tutor.service';

@Controller('tutor')
export class TutorController {
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
}

@Module({
  controllers: [TutorController],
  providers: [TutorService, TutorRetrievalRepository],
})
export class TutorModule {}
