import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import * as tokenService from '../services/token.service';
import * as emailService from '../services/email.service';
import { redis } from '../config/redis';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;
// TTL bookkeeping from the Redis mock: the in-memory store has no real TTLs, so
// these are the only way to pin "armed with EX 900" and "the window was set once".
const mockRedisTtls = (globalThis as Record<string, unknown>).__mockRedisTtls as Map<
  string,
  { mode: string; ttl: number }
>;
const mockRedisExpireCalls = (globalThis as Record<string, unknown>)
  .__mockRedisExpireCalls as Map<string, number>;

beforeEach(() => {
  mockQuery.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/v1/auth/register', () => {
  const validBody = {
    name: 'Test User',
    email: 'test@example.com',
    phone: '+1234567890',
    password: 'Password1',
    business_name: 'Test Biz',
  };

  it('registers a new user without issuing tokens', async () => {
    const issueTokenPairSpy = vi.spyOn(tokenService, 'issueTokenPair');
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // email check
      .mockResolvedValueOnce({
        rows: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test User', email: 'test@example.com' }],
      }); // insert

    const res = await request(app).post('/api/v1/auth/register').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('test@example.com');
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(issueTokenPairSpy).not.toHaveBeenCalled();
  });

  it('should return 409 for duplicate email', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] });

    const res = await request(app).post('/api/v1/auth/register').send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });

  it('should return 400 for invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validBody, email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for short password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validBody, password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for password without uppercase', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validBody, password: 'password1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for password without number', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validBody, password: 'Password' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for invalid E.164 phone', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validBody, phone: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for name too short', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validBody, name: 'A' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should persist language: ar in the INSERT and forward it to the verification email', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // email check
      .mockResolvedValueOnce({
        rows: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test User', email: 'test@example.com', language: 'ar' }],
      }); // user insert

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validBody, language: 'ar' });

    expect(res.status).toBe(201);

    // The INSERT params (call index 1, arg index 1) must include 'ar'
    const insertParams = (mockQuery.mock.calls[1] as unknown[])[1] as unknown[];
    expect(insertParams).toContain('ar');

    // The email pipeline must have queried email_templates with language 'ar'
    const emailTemplateCall = mockQuery.mock.calls.find(
      (call) => typeof (call as unknown[])[0] === 'string' && ((call as unknown[])[0] as string).includes('email_templates'),
    ) as unknown[] | undefined;
    expect(emailTemplateCall).toBeDefined();
    expect((emailTemplateCall![1] as unknown[])).toContain('ar');
  });

  it('should default language to en in the INSERT when not provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // email check
      .mockResolvedValueOnce({
        rows: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test User', email: 'test@example.com', language: 'en' }],
      }); // user insert

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(validBody); // no language field

    expect(res.status).toBe(201);

    // INSERT params must include 'en' as the language value
    const insertParams = (mockQuery.mock.calls[1] as unknown[])[1] as unknown[];
    expect(insertParams).toContain('en');
  });

  it('should return 400 VALIDATION_ERROR for unsupported language code', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validBody, language: 'xx' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/auth/login', () => {
  const loginBody = { email: 'test@example.com', password: 'Password1' };

  // bcrypt hash for "Password1" with cost 12
  const bcryptHash = '$2b$12$LJ3m4ys3Lg2VHqwMwKMfveYYP8wOg/GBR8sMSoRqpNRoCxGt7mfSa';

  it('should return 401 for non-existent user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/v1/auth/login').send(loginBody);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('should return 403 for suspended account', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'user-id', name: 'Test', email: 'test@example.com',
        password_hash: bcryptHash, is_verified: true, is_active: false,
        failed_login_attempts: 0, locked_until: null,
      }],
    });

    const res = await request(app).post('/api/v1/auth/login').send(loginBody);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('should return 423 for locked account', async () => {
    const futureDate = new Date(Date.now() + 10 * 60 * 1000);
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'user-id', name: 'Test', email: 'test@example.com',
        password_hash: bcryptHash, is_verified: true, is_active: true,
        failed_login_attempts: 5, locked_until: futureDate,
      }],
    });

    const res = await request(app).post('/api/v1/auth/login').send(loginBody);

    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('should return 401 and increment attempts on wrong password', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'user-id', name: 'Test', email: 'test@example.com',
          password_hash: bcryptHash, is_verified: true, is_active: true,
          failed_login_attempts: 0, locked_until: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // update attempts

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ ...loginBody, password: 'WrongPass1' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('should return 400 for missing password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('should return 400 for missing refresh token', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 401 for invalid refresh token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'invalid-token' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });
});

describe('POST /api/v1/auth/verify-email', () => {
  it('should return 400 for invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: 'not-an-email', otp: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for wrong OTP length', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: 'test@example.com', otp: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('verifies the email and signs the user in', async () => {
    const userId = '550e8400-e29b-41d4-a716-446655440001';
    const otp = await tokenService.createVerificationOtp(userId);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: userId, name: 'Test User', email: 'test@example.com', role: 'user', is_active: true }] }) // SELECT
      .mockResolvedValueOnce({ rows: [{ id: userId }] }); // UPDATE

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: 'test@example.com', otp });

    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual({ id: userId, name: 'Test User', email: 'test@example.com', role: 'user' });
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(tokenService.verifyAccessToken(res.body.data.accessToken as string).userId).toBe(userId);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect((mockQuery.mock.calls[1] as unknown[])[0]).toContain('is_verified = TRUE');
    expect((mockQuery.mock.calls[1] as unknown[])[0]).toContain('is_active = TRUE');
    expect((mockQuery.mock.calls[1] as unknown[])[0]).toContain("role = 'user'");
    // Body mode only — verify-email must never set the admin refresh cookie.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('refuses a suspended account before issuing tokens', async () => {
    const userId = '550e8400-e29b-41d4-a716-446655440002';
    const issueTokenPairSpy = vi.spyOn(tokenService, 'issueTokenPair');
    mockQuery.mockResolvedValueOnce({ rows: [{ id: userId, name: 'Test User', email: 'test@example.com', role: 'user', is_active: false }] });

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: 'test@example.com', otp: '123456' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(issueTokenPairSpy).not.toHaveBeenCalled();
  });

  it('returns 400 OTP_INVALID for a wrong code and issues no tokens', async () => {
    const userId = '550e8400-e29b-41d4-a716-446655440003';
    const issueTokenPairSpy = vi.spyOn(tokenService, 'issueTokenPair');
    await tokenService.createVerificationOtp(userId);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: userId, name: 'Test User', email: 'test@example.com', role: 'user', is_active: true }] });

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: 'test@example.com', otp: '000000' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_INVALID');
    expect(res.body.data).toBeUndefined();
    expect(issueTokenPairSpy).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns 400 ALREADY_VERIFIED when the account is already verified', async () => {
    const userId = '550e8400-e29b-41d4-a716-446655440004';
    const otp = await tokenService.createVerificationOtp(userId);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: userId, name: 'Test User', email: 'test@example.com', role: 'user', is_active: true }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // UPDATE returns empty — already verified

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: 'test@example.com', otp });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ALREADY_VERIFIED');
    expect(res.body.data).toBeUndefined();
  });

  it('returns 404 for an unknown email', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: 'unknown@example.com', otp: '123456' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  // ── OTP guess-budget hardening ──────────────────────────────────────────
  // The wrong-code lockout must be DURABLE: it outlives the OTP it was earned
  // on, so the "5 guesses -> 429 -> resend -> 5 fresh guesses" loop cannot be
  // used to mine a 6-digit code (authLimiter is per-IP only and rotates away).

  it('locks the flow after 5 wrong codes and keeps it locked for the correct code', async () => {
    const userId = '550e8400-e29b-41d4-a716-446655440010';
    const email = 'lockout@example.com';
    const correctOtp = await tokenService.createVerificationOtp(userId);
    const issueTokenPairSpy = vi.spyOn(tokenService, 'issueTokenPair');
    const redisEvalSpy = vi.spyOn(redis, 'eval');
    const userRow = {
      rows: [{ id: userId, name: 'Test User', email, role: 'user', is_active: true }],
    };

    const results: { status: number; code: string }[] = [];
    for (let i = 0; i < 5; i++) {
      mockQuery.mockResolvedValueOnce(userRow); // every attempt does its own SELECT
      const attempt = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ email, otp: '000000' });
      results.push({ status: attempt.status, code: attempt.body.error.code });
    }

    expect(results.slice(0, 4)).toEqual(
      Array.from({ length: 4 }, () => ({ status: 400, code: 'OTP_INVALID' })),
    );
    expect(results[4]).toEqual({ status: 429, code: 'OTP_LOCKED' });

    // Pin the lock's TTL args. The lock is now armed INSIDE the validate Lua
    // script (redis.set never fires), so we assert on what the script actually
    // wrote: a typo (wrong mode, missing ttl, wrong seconds) would otherwise
    // silently ship a permanent lock without any test noticing.
    expect(mockRedisTtls.get(`otp-lock:${userId}:verify`)).toEqual({ mode: 'EX', ttl: 900 });

    // ...and that the lock TTL really travelled as the script's last ARGV.
    const validateCalls = redisEvalSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && (call[0] as string).startsWith('-- otp-validate'),
    );
    expect(validateCalls).toHaveLength(5);
    for (const call of validateCalls) {
      expect(call[call.length - 1]).toBe(String(900));
    }

    // The CORRECT code is worthless while the lock stands.
    mockQuery.mockResolvedValueOnce(userRow);
    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email, otp: correctOtp });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('OTP_LOCKED');
    expect(issueTokenPairSpy).not.toHaveBeenCalled();
    const updates = mockQuery.mock.calls.filter(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('UPDATE users'),
    );
    expect(updates).toHaveLength(0);
  });

  it('a resend during the lock is refused and does not clear it', async () => {
    const userId = '550e8400-e29b-41d4-a716-446655440011';
    const email = 'lockout-resend@example.com';
    await tokenService.createVerificationOtp(userId);
    const userRow = {
      rows: [{ id: userId, name: 'Test User', email, role: 'user', is_active: true }],
    };
    for (let i = 0; i < 5; i++) {
      mockQuery.mockResolvedValueOnce(userRow);
      await request(app).post('/api/v1/auth/verify-email').send({ email, otp: '000000' });
    }

    const sendOtpSpy = vi
      .spyOn(emailService, 'sendVerificationOtp')
      .mockResolvedValue(undefined);
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: userId, name: 'Test User', is_verified: false, language: 'en' }],
    }); // the SELECT resendVerification makes

    const resend = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email });

    expect(resend.status).toBe(429);
    expect(resend.body.error.code).toBe('OTP_LOCKED');
    expect(sendOtpSpy).not.toHaveBeenCalled();

    // Even a code minted out-of-band during the lock stays unusable.
    const freshOtp = await tokenService.createVerificationOtp(userId);
    mockQuery.mockResolvedValueOnce(userRow);
    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email, otp: freshOtp });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('OTP_LOCKED');
  });

  it('guesses with no live code are not counted and cannot pre-lock the flow', async () => {
    const userId = '550e8400-e29b-41d4-a716-446655440012';
    const email = 'no-live-code@example.com';
    const userRow = {
      rows: [{ id: userId, name: 'Test User', email, role: 'user', is_active: true }],
    };

    // Nothing seeded. Six wrong guesses — one past the lock threshold — must all
    // be plain 400s: counting a guess made against a non-existent code would let
    // anyone keep a stranger's verify flow permanently locked (M-A, denial half).
    for (let i = 0; i < 6; i++) {
      mockQuery.mockResolvedValueOnce(userRow);
      const attempt = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ email, otp: '000000' });

      expect(attempt.status).toBe(400);
      expect(attempt.body.error.code).toBe('OTP_INVALID');
    }
    expect(mockRedisExpireCalls.get(`otp-attempts:${userId}:verify`) ?? 0).toBe(0);

    // The real code still works — the flow was never pre-locked.
    const otp = await tokenService.createVerificationOtp(userId);
    mockQuery
      .mockResolvedValueOnce(userRow) // SELECT
      .mockResolvedValueOnce({ rows: [{ id: userId }] }); // UPDATE

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email, otp });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
  });

  it('resend-verification is capped per email even when the account does not exist', async () => {
    const email = 'ghost-resend@example.com';

    for (let i = 0; i < 5; i++) {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // unknown email -> silent 200
      const allowed = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({ email });
      expect(allowed.status).toBe(200);
    }
    expect(mockQuery).toHaveBeenCalledTimes(5);

    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('EMAIL_RATE_LIMIT_EXCEEDED');
    // The cap fires before the lookup, so known and unknown emails are
    // indistinguishable — no enumeration signal and no wasted DB round-trip.
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it('the resend cap window is fixed, not sliding', async () => {
    const email = 'fixed-window-resend@example.com';

    for (let i = 0; i < 5; i++) {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // unknown email -> silent 200
      const allowed = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({ email });
      expect(allowed.status).toBe(200);
    }

    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('EMAIL_RATE_LIMIT_EXCEEDED');

    // The TTL is armed exactly once, when the counter is created. A sliding
    // window re-EXPIREs on every call — including the refused ones — so one
    // request per hour would keep the budget exhausted forever (M-A).
    expect(mockRedisExpireCalls.get(`otp-send:${email}:verify`)).toBe(1);
  });
});

describe('POST /api/v1/auth/forgot-password', () => {
  it('should return 200 even for non-existent email (prevent enumeration)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nonexistent@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should return 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('forgot-password is capped per email even when the account does not exist', async () => {
    const email = 'ghost-forgot@example.com';

    for (let i = 0; i < 5; i++) {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // unknown email -> silent 200
      const allowed = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email });
      expect(allowed.status).toBe(200);
    }
    expect(mockQuery).toHaveBeenCalledTimes(5);

    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('EMAIL_RATE_LIMIT_EXCEEDED');
    // The cap fires before the SELECT, so a known and an unknown address are
    // indistinguishable — the 429 leaks nothing and costs no DB round-trip.
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });
});

describe('POST /api/v1/auth/reset-password', () => {
  it('should return 400 for weak new password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: 'test@example.com', otp: '123456', newPassword: 'weak' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for missing OTP', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: 'test@example.com', newPassword: 'NewPass1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('should return 400 for missing refresh token', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 200 for expired/invalid token (graceful logout)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: 'some-expired-token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Token Service', () => {
  it('should generate and verify access tokens', async () => {
    const { generateAccessToken, verifyAccessToken } = await import('../services/token.service');

    const token = generateAccessToken({
      userId: 'test-id',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
    });

    expect(token).toBeDefined();
    const payload = verifyAccessToken(token);
    expect(payload.userId).toBe('test-id');
    expect(payload.email).toBe('test@example.com');
  });

  it('should generate and verify refresh tokens', async () => {
    const { generateRefreshToken, verifyRefreshToken } = await import('../services/token.service');

    const { token, jti } = generateRefreshToken('user-123');
    expect(token).toBeDefined();
    expect(jti).toBeDefined();

    const payload = verifyRefreshToken(token);
    expect(payload.userId).toBe('user-123');
    expect(payload.jti).toBe(jti);
  });

  it('should reject tampered access tokens', async () => {
    const { verifyAccessToken } = await import('../services/token.service');

    expect(() => verifyAccessToken('invalid.token.here')).toThrow();
  });
});

describe('Validators', () => {
  it('should reject register body with missing required fields', async () => {
    const { registerSchema } = await import('../validators/auth.validators');
    const result = registerSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should accept valid register body', async () => {
    const { registerSchema } = await import('../validators/auth.validators');
    const result = registerSchema.safeParse({
      name: 'Test User',
      email: 'test@example.com',
      password: 'Password1',
    });
    expect(result.success).toBe(true);
  });

  it('should reject password without uppercase', async () => {
    const { registerSchema } = await import('../validators/auth.validators');
    const result = registerSchema.safeParse({
      name: 'Test',
      email: 'test@example.com',
      password: 'password1',
    });
    expect(result.success).toBe(false);
  });
});

describe('Refresh-token rotation — atomic consume race (F4 regression)', () => {
  it('only the first of two concurrent refreshes with the same token succeeds', async () => {
    const { generateRefreshToken } = await import('../services/token.service');
    const userId = '550e8400-e29b-41d4-a716-446655440000';
    const { token: refreshToken } = generateRefreshToken(userId);
    const consumeSpy = vi.spyOn(tokenService, 'consumeRefreshToken')
      .mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockQuery.mockResolvedValue({ rows: [{ id: userId, name: 'Test User', email: 'test@example.com', role: 'user' }] });
    const [res1, res2] = await Promise.all([
      request(app).post('/api/v1/auth/refresh').send({ refreshToken }),
      request(app).post('/api/v1/auth/refresh').send({ refreshToken }),
    ]);
    expect([res1.status, res2.status].sort()).toEqual([200, 401]);
    const ok = [res1, res2].find((r) => r.status === 200)!;
    const fail = [res1, res2].find((r) => r.status === 401)!;
    expect(ok.body.data.accessToken).toBeDefined();
    expect(fail.body.error.code).toBe('REFRESH_TOKEN_REVOKED');
    expect(consumeSpy).toHaveBeenCalledTimes(2);
    // Both calls targeted the same userId and the same jti — proving they raced on identical token
    expect(consumeSpy.mock.calls[0][0]).toBe(userId);
    expect(consumeSpy.mock.calls.every((c) => c[0] === userId)).toBe(true);
    expect(consumeSpy.mock.calls[0][1]).toBe(consumeSpy.mock.calls[1][1]);
    consumeSpy.mockRestore();
  });
});
