import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  AuthenticatedOnly,
  AuthenticatedUser,
  CurrentUser,
  Public,
} from '../common/decorators/access.decorators';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { clearAuthCookies, REFRESH_TOKEN_COOKIE, setAuthCookies } from './auth-cookies';
import { LoginInput, loginSchema } from './auth.schemas';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('sessions')
  @HttpCode(200)
  async createSession(
    @Body(zodBody(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } = await this.authService.authenticateWithPassword(
      body,
      req.ip,
    );
    setAuthCookies(res, accessToken, refreshToken);
    return { user };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refreshSession(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { accessToken, refreshToken, user } = await this.authService.rotateRefreshToken(
        req.cookies?.[REFRESH_TOKEN_COOKIE],
      );
      setAuthCookies(res, accessToken, refreshToken);
      return { user };
    } catch (error) {
      clearAuthCookies(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async destroySession(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.revokeRefreshToken(req.cookies?.[REFRESH_TOKEN_COOKIE]);
    clearAuthCookies(res);
  }

  @AuthenticatedOnly()
  @Get('me')
  async getCurrentUser(@CurrentUser() user: AuthenticatedUser) {
    return { user: await this.authService.getProfile(user.id) };
  }
}
