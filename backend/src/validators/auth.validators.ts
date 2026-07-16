import { z } from 'zod';

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const registerSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters'),
  email: z.string().email('Invalid email address'),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, 'Phone must be in E.164 format (e.g. +1234567890)')
    .optional(),
  password: passwordSchema,
  business_name: z.string().max(200).optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// refreshToken in the BODY is optional on refresh/logout: the admin SPA sends
// it via the HttpOnly `wasel_rt` cookie instead. A provided-but-invalid value
// (empty string, wrong type) still fails validation exactly as before; the
// controller re-checks against `requiredRefreshTokenSchema` when neither the
// body nor the cookie carries a token, so the missing-token error response is
// byte-identical to the legacy body-only behavior.
export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required').optional(),
});

/**
 * Strict variant used by the auth controller to reproduce the exact legacy
 * VALIDATION_ERROR when no refresh token can be resolved from body or cookie.
 */
export const requiredRefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
  newPassword: passwordSchema,
});

export const verifyEmailSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required').optional(),
});

export const updateProfileSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters'),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, 'Phone must be in E.164 format (e.g. +1234567890)')
    .optional(),
  business_name: z.string().max(200).optional(),
  language: z.enum(['en', 'ar']).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

export const changeEmailSchema = z.object({
  newEmail: z
    .string()
    .email('Invalid email address')
    .max(255, 'Email must be at most 255 characters')
    .transform((e) => e.trim().toLowerCase()),
});

export const verifyEmailChangeSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
});
