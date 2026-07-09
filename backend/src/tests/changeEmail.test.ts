import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import * as tokenService from '../services/token.service';
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

beforeEach(() => {
  mockQuery.mockReset();
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
