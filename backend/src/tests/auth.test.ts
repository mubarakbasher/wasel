import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
});

describe('POST /api/v1/auth/register', () => {
  const validBody = {
    name: 'Test User',
    email: 'test@example.com',
    phone: '+1234567890',
    password: 'Password1',
    business_name: 'Test Biz',
  };

  it('should register a new user and return tokens', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // email check
      .mockResolvedValueOnce({
        rows: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test User', email: 'test@example.com' }],
      }); // insert

    const res = await request(app).post('/api/v1/auth/register').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('test@example.com');
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
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
  it('should return 400 for invalid UUID', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ userId: 'not-a-uuid', otp: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for wrong OTP length', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ userId: '550e8400-e29b-41d4-a716-446655440000', otp: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
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
