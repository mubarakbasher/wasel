import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { redis } from '../config/redis';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';

const REFRESH_PREFIX = 'refresh';
const OTP_VERIFY_PREFIX = 'otp:verify';
const OTP_RESET_PREFIX = 'otp:reset';
const OTP_ATTEMPTS_PREFIX = 'otp-attempts';

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const OTP_VERIFY_TTL_SECONDS = 24 * 60 * 60;  // 24 hours
const OTP_RESET_TTL_SECONDS = 15 * 60;         // 15 minutes
const OTP_ATTEMPTS_TTL_SECONDS = 60 * 60;      // 1 hour
const OTP_MAX_ATTEMPTS = 5;

export interface AccessTokenPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
}

export interface RefreshTokenPayload {
  userId: string;
  jti: string;
}

export function generateAccessToken(payload: AccessTokenPayload): string {
  const opts: SignOptions = { expiresIn: config.JWT_ACCESS_EXPIRES_IN as `${number}${'s' | 'm' | 'h' | 'd'}` };
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, opts);
}

export function generateRefreshToken(userId: string): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const opts: SignOptions = { expiresIn: config.JWT_REFRESH_EXPIRES_IN as `${number}${'s' | 'm' | 'h' | 'd'}` };
  const token = jwt.sign({ userId, jti }, config.JWT_REFRESH_SECRET, opts);
  return { token, jti };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenPayload & JwtPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.JWT_REFRESH_SECRET) as RefreshTokenPayload & JwtPayload;
}

export async function storeRefreshToken(userId: string, jti: string): Promise<void> {
  const key = `${REFRESH_PREFIX}:${userId}:${jti}`;
  await redis.set(key, '1', 'EX', REFRESH_TTL_SECONDS);
}

export async function isRefreshTokenValid(userId: string, jti: string): Promise<boolean> {
  const key = `${REFRESH_PREFIX}:${userId}:${jti}`;
  const exists = await redis.exists(key);
  return exists === 1;
}

export async function revokeRefreshToken(userId: string, jti: string): Promise<void> {
  const key = `${REFRESH_PREFIX}:${userId}:${jti}`;
  await redis.del(key);
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  const pattern = `${REFRESH_PREFIX}:${userId}:*`;
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
  logger.info('Revoked all refresh tokens', { userId });
}

export async function issueTokenPair(
  userId: string,
  email: string,
  name: string,
  role: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = generateAccessToken({ userId, email, name, role });
  const { token: refreshToken, jti } = generateRefreshToken(userId);
  await storeRefreshToken(userId, jti);
  return { accessToken, refreshToken };
}

// --- OTP ---

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Record a wrong OTP attempt. If the counter crosses the lockout threshold,
 * delete the OTP key (so the code is unusable) and reset the counter. The
 * caller must then throw a 429 so the user restarts the flow.
 *
 * Returns true when the lockout was triggered by this attempt, false otherwise.
 */
async function recordWrongOtpAttempt(otpKey: string, flow: string, subject: string): Promise<boolean> {
  const attemptsKey = `${OTP_ATTEMPTS_PREFIX}:${subject}:${flow}`;
  const count = await redis.incr(attemptsKey);
  if (count === 1) {
    await redis.expire(attemptsKey, OTP_ATTEMPTS_TTL_SECONDS);
  }
  if (count >= OTP_MAX_ATTEMPTS) {
    await redis.del(otpKey);
    await redis.del(attemptsKey);
    return true;
  }
  return false;
}

async function clearOtpAttempts(flow: string, subject: string): Promise<void> {
  await redis.del(`${OTP_ATTEMPTS_PREFIX}:${subject}:${flow}`);
}

export async function createVerificationOtp(userId: string): Promise<string> {
  const otp = generateOtp();
  const key = `${OTP_VERIFY_PREFIX}:${userId}`;
  await redis.set(key, otp, 'EX', OTP_VERIFY_TTL_SECONDS);
  // Reset any prior attempt counter so a fresh OTP gets its own 5-try budget.
  await clearOtpAttempts('verify', userId);
  return otp;
}

export async function validateVerificationOtp(userId: string, otp: string): Promise<boolean> {
  const key = `${OTP_VERIFY_PREFIX}:${userId}`;
  const stored = await redis.get(key);
  if (!stored || stored !== otp) {
    const locked = await recordWrongOtpAttempt(key, 'verify', userId);
    if (locked) {
      throw new AppError(429, 'Too many wrong codes. Please restart.', 'OTP_LOCKED');
    }
    return false;
  }
  await redis.del(key);
  await clearOtpAttempts('verify', userId);
  return true;
}

export async function createPasswordResetOtp(email: string): Promise<string> {
  const otp = generateOtp();
  const key = `${OTP_RESET_PREFIX}:${email}`;
  await redis.set(key, otp, 'EX', OTP_RESET_TTL_SECONDS);
  await clearOtpAttempts('reset', email.toLowerCase());
  return otp;
}

export async function validatePasswordResetOtp(email: string, otp: string): Promise<boolean> {
  const key = `${OTP_RESET_PREFIX}:${email}`;
  const subject = email.toLowerCase();
  const stored = await redis.get(key);
  if (!stored || stored !== otp) {
    const locked = await recordWrongOtpAttempt(key, 'reset', subject);
    if (locked) {
      throw new AppError(429, 'Too many wrong codes. Please restart.', 'OTP_LOCKED');
    }
    return false;
  }
  await redis.del(key);
  await clearOtpAttempts('reset', subject);
  return true;
}
