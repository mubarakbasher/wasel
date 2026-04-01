import bcrypt from 'bcrypt';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import logger from '../config/logger';
import * as tokenService from './token.service';
import * as emailService from './email.service';

const BCRYPT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  business_name: string | null;
  password_hash: string;
  is_verified: boolean;
  is_active: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
  created_at: Date;
  role: string;
}

interface RegisterInput {
  name: string;
  email: string;
  phone?: string;
  password: string;
  business_name?: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface RegisterResult {
  user: { id: string; name: string; email: string; role: string };
  tokens: AuthTokens;
}

interface LoginResult {
  user: { id: string; name: string; email: string; role: string };
  tokens: AuthTokens;
}

export async function register(input: RegisterInput): Promise<RegisterResult> {
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [input.email]);
  if (existing.rows.length > 0) {
    throw new AppError(409, 'Email already registered', 'EMAIL_EXISTS');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const result = await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, business_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email`,
    [input.name, input.email, input.phone || null, passwordHash, input.business_name || null],
  );

  const user = result.rows[0];

  const otp = await tokenService.createVerificationOtp(user.id);
  await emailService.sendVerificationOtp(user.email, user.name, otp);

  const tokens = await tokenService.issueTokenPair(user.id, user.email, user.name, 'user');

  logger.info('User registered', { userId: user.id, email: user.email });
  return { user: { id: user.id, name: user.name, email: user.email, role: 'user' }, tokens };
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const result = await pool.query(
    `SELECT id, name, email, password_hash, is_verified, is_active,
            failed_login_attempts, locked_until, role
     FROM users WHERE email = $1`,
    [email],
  );

  if (result.rows.length === 0) {
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  const user: UserRow = result.rows[0];

  if (!user.is_active) {
    throw new AppError(403, 'Account is suspended', 'ACCOUNT_SUSPENDED');
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const remainingSeconds = Math.ceil(
      (new Date(user.locked_until).getTime() - Date.now()) / 1000,
    );
    throw new AppError(
      423,
      `Account locked. Try again in ${remainingSeconds} seconds`,
      'ACCOUNT_LOCKED',
    );
  }

  const passwordValid = await bcrypt.compare(password, user.password_hash);

  if (!passwordValid) {
    const newAttempts = user.failed_login_attempts + 1;
    if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
      await pool.query(
        `UPDATE users SET failed_login_attempts = $1, locked_until = NOW() + INTERVAL '${LOCKOUT_MINUTES} minutes' WHERE id = $2`,
        [newAttempts, user.id],
      );
      throw new AppError(
        423,
        `Account locked for ${LOCKOUT_MINUTES} minutes after ${MAX_LOGIN_ATTEMPTS} failed attempts`,
        'ACCOUNT_LOCKED',
      );
    }
    await pool.query(
      'UPDATE users SET failed_login_attempts = $1 WHERE id = $2',
      [newAttempts, user.id],
    );
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  if (!user.is_verified) {
    throw new AppError(403, 'Email not verified. Please verify your email first.', 'EMAIL_NOT_VERIFIED');
  }

  // Reset lockout on successful login
  if (user.failed_login_attempts > 0) {
    await pool.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1',
      [user.id],
    );
  }

  const tokens = await tokenService.issueTokenPair(user.id, user.email, user.name, user.role);

  logger.info('User logged in', { userId: user.id });
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role }, tokens };
}

export async function refresh(refreshTokenStr: string): Promise<AuthTokens> {
  let payload: { userId: string; jti: string };
  try {
    payload = tokenService.verifyRefreshToken(refreshTokenStr);
  } catch {
    throw new AppError(401, 'Invalid or expired refresh token', 'REFRESH_TOKEN_INVALID');
  }

  const valid = await tokenService.isRefreshTokenValid(payload.userId, payload.jti);
  if (!valid) {
    throw new AppError(401, 'Refresh token has been revoked', 'REFRESH_TOKEN_REVOKED');
  }

  // Rotate: revoke old, issue new
  await tokenService.revokeRefreshToken(payload.userId, payload.jti);

  const result = await pool.query(
    'SELECT id, name, email, role FROM users WHERE id = $1 AND is_active = TRUE',
    [payload.userId],
  );

  if (result.rows.length === 0) {
    throw new AppError(401, 'User not found or inactive', 'USER_NOT_FOUND');
  }

  const user = result.rows[0];
  return tokenService.issueTokenPair(user.id, user.email, user.name, user.role);
}

export async function verifyEmail(email: string, otp: string): Promise<void> {
  const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (userResult.rows.length === 0) {
    throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  }

  const userId = userResult.rows[0].id;

  const valid = await tokenService.validateVerificationOtp(userId, otp);
  if (!valid) {
    throw new AppError(400, 'Invalid or expired verification code', 'OTP_INVALID');
  }

  const result = await pool.query(
    'UPDATE users SET is_verified = TRUE WHERE id = $1 AND is_verified = FALSE RETURNING id',
    [userId],
  );

  if (result.rows.length === 0) {
    throw new AppError(400, 'User not found or already verified', 'ALREADY_VERIFIED');
  }

  logger.info('Email verified', { userId });
}

export async function forgotPassword(email: string): Promise<void> {
  const result = await pool.query(
    'SELECT id, name FROM users WHERE email = $1 AND is_active = TRUE',
    [email],
  );

  // Always return success to prevent email enumeration
  if (result.rows.length === 0) {
    return;
  }

  const otp = await tokenService.createPasswordResetOtp(email);
  await emailService.sendPasswordResetOtp(email, otp);

  logger.info('Password reset OTP sent', { email });
}

export async function resetPassword(email: string, otp: string, newPassword: string): Promise<void> {
  const valid = await tokenService.validatePasswordResetOtp(email, otp);
  if (!valid) {
    throw new AppError(400, 'Invalid or expired reset code', 'OTP_INVALID');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  const result = await pool.query(
    'UPDATE users SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL WHERE email = $2 AND is_active = TRUE RETURNING id',
    [passwordHash, email],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  }

  const userId = result.rows[0].id;
  await tokenService.revokeAllRefreshTokens(userId);

  logger.info('Password reset successful', { userId });
}

export async function logout(refreshTokenStr: string): Promise<void> {
  let payload: { userId: string; jti: string };
  try {
    payload = tokenService.verifyRefreshToken(refreshTokenStr);
  } catch {
    // Token already expired or invalid — treat as successful logout
    return;
  }

  await tokenService.revokeRefreshToken(payload.userId, payload.jti);
  logger.info('User logged out', { userId: payload.userId });
}
