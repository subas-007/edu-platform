import { Body, Controller, Delete, Get, HttpCode, Ip, Module, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { Permission } from '../common/security/permissions';
import {
  AiSettingsService,
  ListModelsInput,
  listModelsSchema,
  UpdateAiSettingsInput,
  updateAiSettingsSchema,
} from './ai-settings.service';

/**
 * A student's choice of AI model: the server's free local model, or a hosted provider with
 * their own API key. Saving or listing models calls the provider, so these are rate-limited.
 */
@Controller('me/ai-settings')
@RequirePermissions(Permission.TutorUse)
export class AiSettingsController {
  constructor(private readonly service: AiSettingsService) {}

  @Get()
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getSettings(user.id);
  }

  @Put()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(updateAiSettingsSchema)) body: UpdateAiSettingsInput,
    @Ip() ip: string,
  ) {
    return this.service.updateSettings(user.id, body, ip);
  }

  @Post('models')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  listModels(@CurrentUser() user: AuthenticatedUser, @Body(zodBody(listModelsSchema)) body: ListModelsInput) {
    return this.service.listModels(user.id, body);
  }

  @Delete('key')
  removeKey(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return this.service.removeKey(user.id, ip);
  }
}

@Module({
  controllers: [AiSettingsController],
  providers: [AiSettingsService],
})
export class AiSettingsModule {}
