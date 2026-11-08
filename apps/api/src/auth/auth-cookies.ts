import type { CookieOptions, Response } from 'express';
import { env, isProduction } from '../config/env';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
/** Refresh cookie is only ever sent to the auth endpoints. */
const REFRESH_COOKIE_PATH = '/api/v1/auth';

const baseCookie: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict',
};

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
    ...baseCookie,
    path: '/',
    maxAge: env.ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...baseCookie,
    path: REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...baseCookie, path: '/' });
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...baseCookie, path: REFRESH_COOKIE_PATH });
}
