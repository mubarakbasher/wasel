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
  language?: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface RegisterResult {
  user: { id: string; name: string; email: string; role: string };
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
    `INSERT INTO users (name, email, phone, password_hash, business_name, language)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, email, language`,
    [input.name, input.email, input.phone || null, passwordHash, input.business_name || null, input.language ?? 'en'],
  );

  const user = result.rows[0];

  const otp = await tokenService.createVerificationOtp(user.id);
  await emailService.sendVerificationOtp(user.email, user.name, otp, user.language ?? 'en');

  // Tokens are NOT issued at registration — they are issued upon email verification.
  logger.info('User registered', { userId: user.id, email: user.email });
  return { user: { id: user.id, name: user.name, email: user.email, role: 'user' } };
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
        `UPDATE users SET failed_login_attempts = $1, locked_until = NOW() + (($3)::int || ' minutes')::interval WHERE id = $2`,
        [newAttempts, user.id, LOCKOUT_MINUTES],
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

  // Atomically consume the token — only the caller that deletes the Redis key
  // proceeds. Closes the rotation race (F4).
  const consumed = await tokenService.consumeRefreshToken(payload.userId, payload.jti);
  if (!consumed) {
    throw new AppError(401, 'Refresh token has been revoked', 'REFRESH_TOKEN_REVOKED');
  }

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

export async function verifyEmail(email: string, otp: string): Promise<LoginResult> {
  const userResult = await pool.query(
    'SELECT id, name, email, role, is_active FROM users WHERE email = $1',
    [email],
  );
  if (userResult.rows.length === 0) {
    throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  }

  const user = userResult.rows[0] as Pick<UserRow, 'id' | 'name' | 'email' | 'role' | 'is_active'>;
  const userId = user.id;

  if (!user.is_active) {
    throw new AppError(403, 'Account is suspended', 'ACCOUNT_SUSPENDED');
  }

  const valid = await tokenService.validateVerificationOtp(userId, otp);
  if (!valid) {
    throw new AppError(400, 'Invalid or expired verification code', 'OTP_INVALID');
  }

  // Re-assert every precondition inside the write: the row must still be
  // unverified, still active (suspension mid-request loses the race, not us)
  // and still a plain user — this endpoint must never mint a pair for an
  // admin-role row. 0 rows -> ALREADY_VERIFIED, same as before.
  const result = await pool.query(
    `UPDATE users SET is_verified = TRUE
     WHERE id = $1 AND is_verified = FALSE AND is_active = TRUE AND role = 'user'
     RETURNING id`,
    [userId],
  );

  if (result.rows.length === 0) {
    throw new AppError(400, 'User not found or already verified', 'ALREADY_VERIFIED');
  }

  const tokens = await tokenService.issueTokenPair(user.id, user.email, user.name, user.role);

  logger.info('Email verified and user signed in', { userId });
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role }, tokens };
}

export async function resendVerification(email: string): Promise<void> {
  // Per-email cap FIRST, before the lookup: known and unknown addresses must
  // burn the same budget and take the same path, or the 429 itself becomes an
  // enumeration oracle. This is independent of the per-IP authLimiter, which a
  // distributed attacker rotates away.
  await tokenService.enforceOtpSendCap('verify', email.trim().toLowerCase());

  const result = await pool.query(
    'SELECT id, name, is_verified, language FROM users WHERE email = $1 AND is_active = TRUE',
    [email],
  );

  if (result.rows.length === 0) {
    // Always return success to prevent email enumeration
    return;
  }

  const user = result.rows[0];

  // Already-verified check comes first: it is the more useful response for a
  // verified-but-locked user, and there is nothing left to lock-check for an
  // account that will never receive another verification OTP.
  if (user.is_verified) {
    throw new AppError(400, 'Email is already verified', 'ALREADY_VERIFIED');
  }

  // Locks only ever exist for real users, so checking here (after the row is
  // found, keyed on the user id) leaks nothing. A fresh code during a lockout
  // is useless — it cannot be redeemed — so refuse instead of emailing it.
  await tokenService.assertOtpNotLocked('verify', user.id);

  const otp = await tokenService.createVerificationOtp(user.id);
  await emailService.sendVerificationOtp(email, user.name, otp, user.language ?? 'en');

  logger.info('Verification OTP resent', { userId: user.id });
}

export async function forgotPassword(email: string): Promise<void> {
  // Per-email cap FIRST, before the lookup — same reasoning as resendVerification:
  // this endpoint mints and mails an OTP, so without a per-subject cap it is a
  // mail bomb and an OTP-rotation oracle from any IP. Running it ahead of the
  // SELECT also keeps unknown and known addresses on an identical path, so the
  // 429 itself never becomes an enumeration signal.
  await tokenService.enforceOtpSendCap('reset', email.trim().toLowerCase());

  const result = await pool.query(
    'SELECT id, name, language FROM users WHERE email = $1 AND is_active = TRUE',
    [email],
  );

  // Always return success to prevent email enumeration
  if (result.rows.length === 0) {
    return;
  }

  const otp = await tokenService.createPasswordResetOtp(email);
  await emailService.sendPasswordResetOtp(email, otp, result.rows[0].language ?? 'en');

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

export async function getProfile(userId: string) {
  const result = await pool.query(
    'SELECT id, name, email, phone, business_name, is_verified, language FROM users WHERE id = $1 AND is_active = TRUE',
    [userId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  }

  return result.rows[0];
}

interface UpdateProfileInput {
  name: string;
  phone?: string;
  business_name?: string;
  language?: 'en' | 'ar';
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  // Build the SET clause dynamically so omitted fields are not overwritten.
  // language is optional — only included when explicitly provided.
  const setClauses: string[] = [
    'name = $1',
    'phone = $2',
    'business_name = $3',
    'updated_at = now()',
  ];
  const values: unknown[] = [
    input.name,
    input.phone ?? null,
    input.business_name ?? null,
  ];

  if (input.language !== undefined) {
    values.push(input.language);
    setClauses.push(`language = $${values.length}`);
  }

  values.push(userId);
  const userIdParam = `$${values.length}`;

  const result = await pool.query(
    `UPDATE users SET ${setClauses.join(', ')}
     WHERE id = ${userIdParam} AND is_active = TRUE
     RETURNING id, name, email, phone, business_name, is_verified, language`,
    values,
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  }

  logger.info('Profile updated', { userId });
  return result.rows[0];
}

export async function changeEmail(userId: string, newEmail: string): Promise<{ pendingEmail: string }> {
  const userResult = await pool.query(
    'SELECT id, name, email, language FROM users WHERE id = $1 AND is_active = TRUE',
    [userId],
  );

  if (userResult.rows.length === 0) {
    throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  }

  const user = userResult.rows[0] as { id: string; name: string; email: string; language: string | null };

  if (user.email.toLowerCase() === newEmail) {
    throw new AppError(400, 'New email matches current email', 'EMAIL_UNCHANGED');
  }

  const existing = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2',
    [newEmail, userId],
  );
  if (existing.rows.length > 0) {
    throw new AppError(409, 'Email already registered', 'EMAIL_EXISTS');
  }

  // Keyed on the AUTHENTICATED user, not the target address: the caller picks
  // newEmail freely, so capping per-address would let one session mail an
  // unlimited number of victims one code each. Enumeration is not a concern
  // here (the route is behind auth), so the cap runs right before the send —
  // after the lookup and the unchanged/existing-email checks — so a request
  // that fails EMAIL_UNCHANGED or EMAIL_EXISTS (which sends nothing) never
  // burns the user's hourly budget on a typo.
  await tokenService.enforceOtpSendCap('email-change', userId);

  const otp = await tokenService.createEmailChangeOtp(userId, newEmail);
  await emailService.sendVerificationOtp(newEmail, user.name, otp, user.language ?? 'en');

  logger.info('Email change OTP sent', { userId });
  return { pendingEmail: newEmail };
}

export async function verifyEmailChange(userId: string, otp: string) {
  const newEmail = await tokenService.validateEmailChangeOtp(userId, otp);
  if (newEmail === null) {
    throw new AppError(400, 'No pending email change or code expired', 'EMAIL_CHANGE_INVALID');
  }

  // Re-check uniqueness in case another user registered that email since the OTP was issued.
  const existing = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2',
    [newEmail, userId],
  );
  if (existing.rows.length > 0) {
    throw new AppError(409, 'Email already registered', 'EMAIL_EXISTS');
  }

  let result;
  try {
    result = await pool.query(
      `UPDATE users SET email = $1, is_verified = TRUE, updated_at = NOW()
       WHERE id = $2 AND is_active = TRUE
       RETURNING id, name, email, phone, business_name, is_verified, language`,
      [newEmail, userId],
    );
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new AppError(409, 'Email already registered', 'EMAIL_EXISTS');
    }
    throw err;
  }

  if (result.rows.length === 0) {
    throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  }

  logger.info('Email changed', { userId });
  return result.rows[0];
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const result = await pool.query(
    'SELECT password_hash FROM users WHERE id = $1 AND is_active = TRUE',
    [userId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  }

  const passwordValid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
  if (!passwordValid) {
    throw new AppError(401, 'Current password is incorrect', 'INVALID_PASSWORD');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await pool.query(
    'UPDATE users SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL WHERE id = $2',
    [passwordHash, userId],
  );

  await tokenService.revokeAllRefreshTokens(userId);

  logger.info('Password changed', { userId });
}
