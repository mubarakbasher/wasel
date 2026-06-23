/**
 * Tests for language persistence via PUT /auth/profile and GET /auth/me.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { TEST_USER, authHeader } from './helpers';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
});

// ─── GET /api/v1/auth/me — language field included ───────────────────────────

describe('GET /api/v1/auth/me', () => {
  it('returns language field in the profile', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: TEST_USER.userId,
        name: TEST_USER.name,
        email: TEST_USER.email,
        phone: null,
        business_name: null,
        is_verified: true,
        language: 'ar',
      }],
    });

    const res = await request(app).get('/api/v1/auth/me').set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.language).toBe('ar');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});

// ─── PUT /api/v1/auth/profile — language field persistence ───────────────────

describe('PUT /api/v1/auth/profile — language field', () => {
  it('accepts language: ar and returns updated profile with language', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: TEST_USER.userId,
        name: TEST_USER.name,
        email: TEST_USER.email,
        phone: null,
        business_name: null,
        is_verified: true,
        language: 'ar',
      }],
    });

    const res = await request(app)
      .put('/api/v1/auth/profile')
      .set(authHeader())
      .send({ name: TEST_USER.name, language: 'ar' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.language).toBe('ar');
  });

  it('accepts language: en', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: TEST_USER.userId,
        name: TEST_USER.name,
        email: TEST_USER.email,
        phone: null,
        business_name: null,
        is_verified: true,
        language: 'en',
      }],
    });

    const res = await request(app)
      .put('/api/v1/auth/profile')
      .set(authHeader())
      .send({ name: TEST_USER.name, language: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.data.language).toBe('en');
  });

  it('rejects invalid language value with 400', async () => {
    const res = await request(app)
      .put('/api/v1/auth/profile')
      .set(authHeader())
      .send({ name: TEST_USER.name, language: 'fr' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('works without language field (field remains unchanged)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: TEST_USER.userId,
        name: TEST_USER.name,
        email: TEST_USER.email,
        phone: null,
        business_name: null,
        is_verified: true,
        language: 'en',
      }],
    });

    const res = await request(app)
      .put('/api/v1/auth/profile')
      .set(authHeader())
      .send({ name: TEST_USER.name });

    expect(res.status).toBe(200);
    expect(res.body.data.language).toBe('en');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/api/v1/auth/profile')
      .send({ name: 'Test', language: 'ar' });

    expect(res.status).toBe(401);
  });
});

// ─── updateProfileSchema validator ───────────────────────────────────────────

describe('updateProfileSchema — language validation', () => {
  it('accepts valid language enum values', async () => {
    const { updateProfileSchema } = await import('../validators/auth.validators');

    expect(updateProfileSchema.safeParse({ name: 'Test', language: 'en' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ name: 'Test', language: 'ar' }).success).toBe(true);
  });

  it('rejects unsupported locale', async () => {
    const { updateProfileSchema } = await import('../validators/auth.validators');
    const result = updateProfileSchema.safeParse({ name: 'Test', language: 'fr' });
    expect(result.success).toBe(false);
  });

  it('allows language to be omitted', async () => {
    const { updateProfileSchema } = await import('../validators/auth.validators');
    const result = updateProfileSchema.safeParse({ name: 'Test' });
    expect(result.success).toBe(true);
  });
});
