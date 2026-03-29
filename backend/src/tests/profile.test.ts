import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import {
  TEST_USER,
  authHeader,
  mockSubscriptionQuery,
  TEST_PROFILE_ID,
} from './helpers';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;
const mockClientQuery = (globalThis as Record<string, unknown>).__mockClientQuery as ReturnType<typeof vi.fn>;

const now = new Date();

const MOCK_PROFILE_ROW = {
  id: TEST_PROFILE_ID,
  user_id: TEST_USER.userId,
  group_name: 'basic-plan',
  display_name: 'Basic Plan',
  bandwidth_up: '2M',
  bandwidth_down: '5M',
  session_timeout: 3600,
  total_time: null,
  total_data: null,
  created_at: now,
  updated_at: now,
};

/**
 * getRadiusAttributes makes 2 pool.query calls (radgroupcheck + radgroupreply).
 */
function mockRadiusAttributeQueries(mq: ReturnType<typeof vi.fn>): void {
  // radgroupcheck
  mq.mockResolvedValueOnce({ rows: [] });
  // radgroupreply
  mq.mockResolvedValueOnce({ rows: [{ attribute: 'Mikrotik-Rate-Limit', op: ':=', value: '2M/5M' }] });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
});

// ─── POST /api/v1/profiles ───────────────────────────────────────────────────

describe('POST /api/v1/profiles', () => {
  const validBody = { groupName: 'test-plan', displayName: 'Test Plan', bandwidthUp: '2M', bandwidthDown: '5M' };

  it('should return 401 without auth', async () => {
    const res = await request(app).post('/api/v1/profiles').send(validBody);
    expect(res.status).toBe(401);
  });

  it('should return 400 for missing required fields', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .post('/api/v1/profiles')
      .set(authHeader())
      .send({ groupName: 'test' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid groupName format', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .post('/api/v1/profiles')
      .set(authHeader())
      .send({ groupName: 'invalid name!', displayName: 'Test' });

    expect(res.status).toBe(400);
  });

  it('should return 409 for duplicate group name', async () => {
    mockSubscriptionQuery(mockQuery);
    // Duplicate check
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });

    const res = await request(app)
      .post('/api/v1/profiles')
      .set(authHeader())
      .send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROFILE_DUPLICATE');
  });

  it('should create profile successfully', async () => {
    mockSubscriptionQuery(mockQuery);
    // Duplicate check: none
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Transaction
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [MOCK_PROFILE_ROW] }) // INSERT radius_profiles
      .mockResolvedValueOnce(undefined) // INSERT radgroupreply (Rate-Limit)
      .mockResolvedValueOnce(undefined) // INSERT radgroupreply (Session-Timeout)
      .mockResolvedValueOnce(undefined); // COMMIT

    // getRadiusAttributes (after COMMIT)
    mockRadiusAttributeQueries(mockQuery);

    const res = await request(app)
      .post('/api/v1/profiles')
      .set(authHeader())
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.groupName).toBe('basic-plan');
    expect(res.body.data.displayName).toBe('Basic Plan');
  });
});

// ─── GET /api/v1/profiles ────────────────────────────────────────────────────

describe('GET /api/v1/profiles', () => {
  it('should return list of profiles', async () => {
    mockSubscriptionQuery(mockQuery);
    // SELECT profiles
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_PROFILE_ROW] });
    // getRadiusAttributes for each profile
    mockRadiusAttributeQueries(mockQuery);

    const res = await request(app)
      .get('/api/v1/profiles')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].groupName).toBe('basic-plan');
  });

  it('should return empty array when no profiles', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/v1/profiles')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

// ─── GET /api/v1/profiles/:pid ───────────────────────────────────────────────

describe('GET /api/v1/profiles/:pid', () => {
  it('should return 400 for invalid UUID', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .get('/api/v1/profiles/not-a-uuid')
      .set(authHeader());

    expect(res.status).toBe(400);
  });

  it('should return 404 when profile not found', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/api/v1/profiles/${TEST_PROFILE_ID}`)
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROFILE_NOT_FOUND');
  });

  it('should return profile on success', async () => {
    mockSubscriptionQuery(mockQuery);
    // SELECT profile
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_PROFILE_ROW] });
    // getRadiusAttributes
    mockRadiusAttributeQueries(mockQuery);

    const res = await request(app)
      .get(`/api/v1/profiles/${TEST_PROFILE_ID}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(TEST_PROFILE_ID);
    expect(res.body.data.radiusAttributes).toBeDefined();
  });
});

// ─── PUT /api/v1/profiles/:pid ───────────────────────────────────────────────

describe('PUT /api/v1/profiles/:pid', () => {
  it('should return 400 when no fields provided', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .put(`/api/v1/profiles/${TEST_PROFILE_ID}`)
      .set(authHeader())
      .send({});

    expect(res.status).toBe(400);
  });

  it('should return 404 when profile not found', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put(`/api/v1/profiles/${TEST_PROFILE_ID}`)
      .set(authHeader())
      .send({ displayName: 'Updated' });

    expect(res.status).toBe(404);
  });

  it('should update profile successfully', async () => {
    mockSubscriptionQuery(mockQuery);
    // SELECT existing profile
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_PROFILE_ROW] });

    // Transaction
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ ...MOCK_PROFILE_ROW, display_name: 'Updated Plan' }] }) // UPDATE
      .mockResolvedValueOnce(undefined) // DELETE radgroupcheck
      .mockResolvedValueOnce(undefined) // DELETE radgroupreply
      .mockResolvedValueOnce(undefined) // INSERT radgroupreply (Rate-Limit)
      .mockResolvedValueOnce(undefined) // INSERT radgroupreply (Session-Timeout)
      .mockResolvedValueOnce(undefined); // COMMIT

    // getRadiusAttributes
    mockRadiusAttributeQueries(mockQuery);

    const res = await request(app)
      .put(`/api/v1/profiles/${TEST_PROFILE_ID}`)
      .set(authHeader())
      .send({ displayName: 'Updated Plan' });

    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe('Updated Plan');
  });
});

// ─── DELETE /api/v1/profiles/:pid ────────────────────────────────────────────

describe('DELETE /api/v1/profiles/:pid', () => {
  it('should return 404 when profile not found', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete(`/api/v1/profiles/${TEST_PROFILE_ID}`)
      .set(authHeader());

    expect(res.status).toBe(404);
  });

  it('should return 409 when profile is in use', async () => {
    mockSubscriptionQuery(mockQuery);
    // SELECT profile
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_PROFILE_ROW] });
    // radusergroup count
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });

    const res = await request(app)
      .delete(`/api/v1/profiles/${TEST_PROFILE_ID}`)
      .set(authHeader());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROFILE_IN_USE');
  });

  it('should delete profile successfully', async () => {
    mockSubscriptionQuery(mockQuery);
    // SELECT profile
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_PROFILE_ROW] });
    // radusergroup count: 0
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    // Transaction
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // DELETE radgroupcheck
      .mockResolvedValueOnce(undefined) // DELETE radgroupreply
      .mockResolvedValueOnce(undefined) // DELETE radius_profiles
      .mockResolvedValueOnce(undefined); // COMMIT

    const res = await request(app)
      .delete(`/api/v1/profiles/${TEST_PROFILE_ID}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
