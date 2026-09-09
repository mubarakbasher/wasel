import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import * as tokenService from '../services/token.service';
import * as emailService from '../services/email.service';
import { redis } from '../config/redis';
import { TEST_USER, authHeader } from './helpers';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

const MOCK_USER_ROW = {
  id: TEST_USER.userId,
  name: TEST_USER.name,
  email: TEST_USER.email, // 'test@example.com'
  language: 'en',
};

const MOCK_UPDATED_USER_ROW = {
  id: TEST_USER.userId,
  name: TEST_USER.name,
  email: 'newemail@example.com',
  phone: null,
  business_name: null,
  is_verified: true,
  language: 'en',
};

beforeEach(async () => {
  mockQuery.mockReset();
  // The mock Redis in setup.ts is module-scoped for the whole FILE and every
  // change-email test reuses TEST_USER.userId, so the per-user OTP send cap
  // would otherwise accumulate across tests and 429 whichever one runs sixth.
  // (The mock's `del` clears counter keys as well as value keys.)
  await redis.del(`otp-send:${TEST_USER.userId}:email-change`);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── POST /api/v1/auth/change-email ─────────────────────────────────────────

describe('POST /api/v1/auth/change-email', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-email')
      .send({ newEmail: 'newemail@example.com' });

    expect(res.status).toBe(401);
  });

  it('should return 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-email')
      .set(authHeader())
      .send({ newEmail: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 EMAIL_UNCHANGED when new email matches current email', async () => {
    // Load user — email is 'test@example.com'
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_USER_ROW] });

    // Schema transforms the input to lowercase; current email already lowercase
    const res = await request(app)
      .post('/api/v1/auth/change-email')
      .set(authHeader())
      .send({ newEmail: TEST_USER.email });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMAIL_UNCHANGED');
  });

  it('should return 409 EMAIL_EXISTS when new email is taken by another user', async () => {
    // Load user
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_USER_ROW] });
    // Uniqueness check: taken by another user
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'other-user-id' }] });

    const res = await request(app)
      .post('/api/v1/auth/change-email')
      .set(authHeader())
      .send({ newEmail: 'taken@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });

  it('should return 200 and call sendVerificationOtp with the new address on happy path', async () => {
    // Load user
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_USER_ROW] });
    // Uniqueness check: not taken
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/v1/auth/change-email')
      .set(authHeader())
      .send({ newEmail: 'newemail@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pendingEmail).toBe('newemail@example.com');
  });

  it('change-email is capped per user', async () => {
    const sendOtpSpy = vi
      .spyOn(emailService, 'sendVerificationOtp')
      .mockResolvedValue(undefined);
    const createOtpSpy = vi.spyOn(tokenService, 'createEmailChangeOtp');

    // A request that fails EMAIL_UNCHANGED sends nothing, so it must not
    // consume the send-cap budget: the cap now runs right before the send,
    // AFTER the unchanged-email check, so this call stops at the single user
    // SELECT and never reaches enforceOtpSendCap.
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_USER_ROW] }); // load user
    const unchanged = await request(app)
      .post('/api/v1/auth/change-email')
      .set(authHeader())
      .send({ newEmail: TEST_USER.email });
    expect(unchanged.status).toBe(400);
    expect(unchanged.body.error.code).toBe('EMAIL_UNCHANGED');
    expect(mockQuery).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      mockQuery.mockResolvedValueOnce({ rows: [MOCK_USER_ROW] }); // load user
      mockQuery.mockResolvedValueOnce({ rows: [] }); // uniqueness check: free
      const allowed = await request(app)
        .post('/api/v1/auth/change-email')
        .set(authHeader())
        .send({ newEmail: `capped${i}@example.com` });
      expect(allowed.status).toBe(200);
    }
    // 1 (EMAIL_UNCHANGED) + 5 * 2 (load user + uniqueness check)
    expect(mockQuery).toHaveBeenCalledTimes(11);
    expect(sendOtpSpy).toHaveBeenCalledTimes(5);
    expect(createOtpSpy).toHaveBeenCalledTimes(5);

    // The 6th request still passes the lookup, unchanged, and existing-email
    // checks — it only trips the cap right before the send — so it still
    // costs the two DB lookups but sends nothing.
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_USER_ROW] }); // load user
    mockQuery.mockResolvedValueOnce({ rows: [] }); // uniqueness check: free
    const res = await request(app)
      .post('/api/v1/auth/change-email')
      .set(authHeader())
      .send({ newEmail: 'capped5@example.com' });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('EMAIL_RATE_LIMIT_EXCEEDED');
    // Capped on the authenticated user, so one session cannot mail an unlimited
    // number of distinct addresses one verification code each. The cap runs
    // right before the send, so the refused call still costs the two lookup
    // queries but never calls createEmailChangeOtp or sends an email.
    expect(mockQuery).toHaveBeenCalledTimes(13);
    expect(sendOtpSpy).toHaveBeenCalledTimes(5);
    expect(createOtpSpy).toHaveBeenCalledTimes(5);
  });
});

// ─── POST /api/v1/auth/verify-email-change ──────────────────────────────────

describe('POST /api/v1/auth/verify-email-change', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-email-change')
      .send({ otp: '123456' });

    expect(res.status).toBe(401);
  });

  it('should return 400 for non-digit OTP', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-email-change')
      .set(authHeader())
      .send({ otp: 'abcdef' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for OTP that is too short', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-email-change')
      .set(authHeader())
      .send({ otp: '12345' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 EMAIL_CHANGE_INVALID when no pending OTP exists in Redis', async () => {
    // No OTP seeded — validateEmailChangeOtp returns null
    const res = await request(app)
      .post('/api/v1/auth/verify-email-change')
      .set(authHeader())
      .send({ otp: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMAIL_CHANGE_INVALID');
  });

  it('should return 200 and return updated user when OTP is valid', async () => {
    const newEmail = 'newemail@example.com';

    // Seed the OTP directly into mock Redis via the service function
    const otp = await tokenService.createEmailChangeOtp(TEST_USER.userId, newEmail);

    // Uniqueness re-check: not taken
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // UPDATE users RETURNING
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_UPDATED_USER_ROW] });

    const res = await request(app)
      .post('/api/v1/auth/verify-email-change')
      .set(authHeader())
      .send({ otp });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('newemail@example.com');
    expect(res.body.data.is_verified).toBe(true);
  });
});
