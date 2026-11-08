import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { ZodValidationPipe, zodBody } from '../common/pipes/zod-validation.pipe';
import { Permission } from '../common/security/permissions';
import { uuidParam } from '../common/validation';
import {
  ListUsersQuery,
  listUsersQuerySchema,
  ProvisionUserInput,
  provisionUserSchema,
  UpdateUserInput,
  updateUserSchema,
} from './users.schemas';
import { UsersService } from './users.service';

@Controller('users')
@RequirePermissions(Permission.UsersManage)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  listUsers(@Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery) {
    return this.usersService.listUsers(query);
  }

  @Post()
  provisionUser(
    @Body(zodBody(provisionUserSchema)) body: ProvisionUserInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.usersService.provisionUser(body, actor, req.ip);
  }

  @Patch(':userId')
  updateUser(
    @Param('userId', uuidParam) userId: string,
    @Body(zodBody(updateUserSchema)) body: UpdateUserInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.usersService.updateUser(userId, body, actor, req.ip);
  }
}
