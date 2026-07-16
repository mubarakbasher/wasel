import { Request, Response, NextFunction, CookieOptions } from 'express';
import { config } from '../config';
import { AuthenticatedRequest } from '../types';
import * as authService from '../services/auth.service';
import { sendZodValidationError } from '../middleware/validate';
import { requiredRefreshTokenSchema } from '../validators/auth.validators';

// ---------------------------------------------------------------------------
// Admin-client cookie mode (HttpOnly refresh cookie for the admin SPA)
// ---------------------------------------------------------------------------
//
// The SAME endpoints serve the mobile app (body-based tokens) and the admin
// SPA (HttpOnly cookie). Requests carrying the `X-Client: admin` header — or
// a `wasel_rt` cookie on refresh/logout — get the cookie flow; every other
// request gets the legacy body-based responses, byte-for-byte unchanged.
// All cookie logic lives here; auth.service / token.service are untouched.

const REFRESH_COOKIE_NAME = 'wasel_rt';
// Scoped to the auth group so no other endpoint ever receives the cookie.
const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Parse a `<number><s|m|h|d>` duration (the shape token.service signs refresh
 * tokens with) into seconds. Falls back to 7 days — the JWT_REFRESH_EXPIRES_IN
 * default — for any other format, so the cookie can never silently outlive an
 * unparsable-but-jwt-valid setting by more than the documented default.
 */
function parseDurationSeconds(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration.trim());
  if (!match) return 7 * 24 * 60 * 60;
  const multipliers = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 } as const;
  return parseInt(match[1], 10) * multipliers[match[2] as keyof typeof multipliers];
}

// Same source as the refresh-token TTL: config.JWT_REFRESH_EXPIRES_IN ('7d').
const REFRESH_COOKIE_MAX_AGE_SECONDS = parseDurationSeconds(config.JWT_REFRESH_EXPIRES_IN);

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    secure: config.NODE_ENV === 'production',
  };
}

/** `X-Client: admin` (header value trimmed, compared case-insensitively). */
function isAdminClient(req: Request): boolean {
  return (req.header('x-client') ?? '').trim().toLowerCase() === 'admin';
}

/** Read the refresh token from the `wasel_rt` cookie, if present. */
function cookieRefreshToken(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Refresh token from the validated body, if present. */
function bodyRefreshToken(req: Request): string | undefined {
  const value: unknown = (req.body as Record<string, unknown> | undefined)?.refreshToken;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function setRefreshCookie(res: Response, refreshToken: string): void {
  // Express takes maxAge in ms and emits Max-Age in seconds.
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...refreshCookieOptions(),
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS * 1000,
  });
}

function clearRefreshCookie(res: Response): void {
  // Attributes must match the ones the cookie was set with (minus Max-Age),
  // or browsers ignore the removal.
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
}

/**
 * Emit the exact legacy missing-refresh-token response (400 VALIDATION_ERROR).
 * Body validation now allows an absent refreshToken so cookie-only requests
 * pass the middleware; when the cookie is absent too, re-running the strict
 * schema reproduces the pre-cookie error byte-for-byte.
 */
function sendMissingRefreshToken(req: Request, res: Response): void {
  const result = requiredRefreshTokenSchema.safeParse(req.body ?? {});
  if (!result.success) {
    sendZodValidationError(res, result.error);
    return;
  }
  // Unreachable (helper is only called when no body token resolved) — kept so
  // a response is always sent even if the calling convention ever drifts.
  res.status(400).json({
    success: false,
    error: {
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: [{ field: 'refreshToken', message: 'Refresh token is required' }],
    },
  });
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.register(req.body);
    res.status(201).json({
      success: true,
      data: {
        user: result.user,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    if (isAdminClient(req)) {
      // Admin SPA: refresh token travels only in the HttpOnly cookie.
      setRefreshCookie(res, result.tokens.refreshToken);
      res.status(200).json({
        success: true,
        data: {
          user: result.user,
          accessToken: result.tokens.accessToken,
        },
      });
      return;
    }
    res.status(200).json({
      success: true,
      data: {
        user: result.user,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const fromBody = bodyRefreshToken(req);
    const fromCookie = cookieRefreshToken(req);
    const refreshToken = fromBody ?? fromCookie;
    if (refreshToken === undefined) {
      // Neither body nor cookie — exact legacy missing-token error.
      sendMissingRefreshToken(req, res);
      return;
    }
    const tokens = await authService.refresh(refreshToken);
    if (fromBody === undefined || isAdminClient(req)) {
      // Cookie-sourced (or admin-flagged): rotate the cookie, never expose
      // the refresh token to script.
      setRefreshCookie(res, tokens.refreshToken);
      res.status(200).json({
        success: true,
        data: { accessToken: tokens.accessToken },
      });
      return;
    }
    res.status(200).json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, otp } = req.body;
    await authService.verifyEmail(email, otp);
    res.status(200).json({
      success: true,
      data: { message: 'Email verified successfully' },
    });
  } catch (error) {
    next(error);
  }
}

export async function resendVerification(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = req.body;
    await authService.resendVerification(email);
    res.status(200).json({
      success: true,
      data: { message: 'If that email is registered and unverified, a new code has been sent' },
    });
  } catch (error) {
    next(error);
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = req.body;
    await authService.forgotPassword(email);
    res.status(200).json({
      success: true,
      data: { message: 'If that email is registered, a reset code has been sent' },
    });
  } catch (error) {
    next(error);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, otp, newPassword } = req.body;
    await authService.resetPassword(email, otp, newPassword);
    res.status(200).json({
      success: true,
      data: { message: 'Password reset successfully. All sessions have been invalidated.' },
    });
  } catch (error) {
    next(error);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const fromBody = bodyRefreshToken(req);
    const fromCookie = cookieRefreshToken(req);
    const refreshToken = fromBody ?? fromCookie;
    const cookieMode = isAdminClient(req) || fromCookie !== undefined;
    if (refreshToken === undefined && !cookieMode) {
      // Legacy body-only client with no token — exact pre-cookie 400.
      sendMissingRefreshToken(req, res);
      return;
    }
    if (refreshToken !== undefined) {
      await authService.logout(refreshToken);
    }
    if (cookieMode) {
      // Idempotent for the admin SPA: clear the cookie even when no token
      // could be resolved (already expired / already logged out).
      clearRefreshCookie(res);
    }
    res.status(200).json({
      success: true,
      data: { message: 'Logged out successfully' },
    });
  } catch (error) {
    next(error);
  }
}

export async function getProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.getProfile(req.user!.id);
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
}

export async function updateProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.updateProfile(req.user!.id, req.body);
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
}

export async function changePassword(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body;
    await authService.changePassword(req.user!.id, currentPassword, newPassword);
    res.status(200).json({
      success: true,
      data: { message: 'Password changed successfully. All sessions have been invalidated.' },
    });
  } catch (error) {
    next(error);
  }
}

export async function changeEmail(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.changeEmail(req.user!.id, req.body.newEmail);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function verifyEmailChange(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.verifyEmailChange(req.user!.id, req.body.otp);
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
}
