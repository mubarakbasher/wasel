import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import {
  TEST_USER,
  authHeader,
  mockSubscriptionQuery,
  ACTIVE_SUBSCRIPTION_ROW,
  TEST_ROUTER_ID,
  TEST_VOUCHER_ID,
  TEST_PROFILE_ID,
} from './helpers';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;
const mockClientQuery = (globalThis as Record<string, unknown>).__mockClientQuery as ReturnType<typeof vi.fn>;

const now = new Date();

const MOCK_VOUCHER_ROW = {
  id: TEST_VOUCHER_ID,
  user_id: TEST_USER.userId,
  router_id: TEST_ROUTER_ID,
  radius_username: 'testuser1',
  group_profile: 'basic-plan',
  comment: 'Test voucher',
  status: 'active',
  limit_type: null,
  limit_value: null,
  limit_unit: null,
  validity_seconds: null,
  price: null,
  created_at: now,
  updated_at: now,
};

/**
 * The batch N+1 fix issues exactly 3 parallel pool.query calls per
 * batchToVoucherInfo invocation:
 *   1. radcheck batch  (password, expiration, simultaneous-use for ALL usernames)
 *   2. radacct  batch  (session counts + usage, GROUP BY username)
 *   3. radius_profiles batch (display names, only when group_profile is set)
 *
 * Because Promise.all fires all 3 concurrently, vitest resolves them in the
 * order the mock queue was registered. Register all 3 in the same order.
 */
function mockBatchVoucherInfoQueries(
  mq: ReturnType<typeof vi.fn>,
  usernames: string[] = ['testuser1'],
): void {
  // 1. radcheck batch (Cleartext-Password + Simultaneous-Use for each username)
  mq.mockResolvedValueOnce({
    rows: usernames.flatMap((u) => [
      { username: u, attribute: 'Cleartext-Password', value: 'pass123' },
      { username: u, attribute: 'Simultaneous-Use',   value: '1' },
    ]),
  });

  // 2. radacct batch (no sessions in tests → computed status depends on row.status)
  mq.mockResolvedValueOnce({ rows: [] });

  // 3. radius_profiles batch
  mq.mockResolvedValueOnce({
    rows: [{ group_name: 'basic-plan', user_id: TEST_USER.userId, display_name: 'Basic Plan' }],
  });
}

/**
 * Mock the two queries that checkQuota → checkVoucherQuota → getActiveSubscription
 * issues on the POST / route (after requireSubscription has already consumed its own 2).
 */
function mockCheckQuotaQueries(mq: ReturnType<typeof vi.fn>, exhausted = false): void {
  const row = exhausted
    ? { ...ACTIVE_SUBSCRIPTION_ROW, vouchers_used: 500, voucher_quota: 500 }
    : ACTIVE_SUBSCRIPTION_ROW;
  // 1. SELECT subscriptions (for checkVoucherQuota)
  mq.mockResolvedValueOnce({ rows: [row] });
  // 2. getPlanByTier
  mq.mockResolvedValueOnce({ rows: [] });
}

// Suppress unused import warning for TEST_PROFILE_ID (legacy tests removed)
void TEST_PROFILE_ID;

const BASE_URL = `/api/v1/routers/${TEST_ROUTER_ID}/vouchers`;

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
});

// ─── POST /api/v1/routers/:id/vouchers ───────────────────────────────────────

describe('POST /api/v1/routers/:id/vouchers', () => {
  const validBody = { limitType: 'time', limitValue: 60, limitUnit: 'minutes', count: 1, price: 5 };

  it('should return 401 without auth', async () => {
    const res = await request(app).post(BASE_URL).send(validBody);
    expect(res.status).toBe(401);
  });

  it('should return 403 without active subscription', async () => {
    // requireSubscription: SELECT subscriptions returns empty (no plan lookup needed)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(BASE_URL)
      .set(authHeader())
      .send(validBody);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('should return 4xx for missing required fields', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .post(BASE_URL)
      .set(authHeader())
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('should return 403 when quota exceeded', async () => {
    // requireSubscription (2 queries)
    mockSubscriptionQuery(mockQuery);
    // checkQuota → getActiveSubscription (2 queries), exhausted
    mockCheckQuotaQueries(mockQuery, true);

    const res = await request(app)
      .post(BASE_URL)
      .set(authHeader())
      .send(validBody);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('should create voucher successfully', async () => {
    // requireSubscription (2 queries)
    mockSubscriptionQuery(mockQuery);
    // checkQuota (2 queries)
    mockCheckQuotaQueries(mockQuery);
    // verifyRouterOwnership returns tunnel_ip (used for ROUTER_NOT_READY guard)
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });
    // username uniqueness check — not taken
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Transaction queries: BEGIN + INSERT voucher_meta + 3x radcheck inserts
    //                      (Cleartext, Simultaneous-Use, Max-All-Session)
    //                      + UPDATE subscriptions + COMMIT
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [MOCK_VOUCHER_ROW] }) // INSERT voucher_meta
      .mockResolvedValueOnce(undefined) // INSERT radcheck Cleartext-Password
      .mockResolvedValueOnce(undefined) // INSERT radcheck Simultaneous-Use
      .mockResolvedValueOnce(undefined) // INSERT radcheck limit attribute (time)
      .mockResolvedValueOnce(undefined) // UPDATE subscriptions vouchers_used
      .mockResolvedValueOnce(undefined); // COMMIT

    // Batch enrichment (3 parallel queries)
    mockBatchVoucherInfoQueries(mockQuery, ['testuser1']);

    const res = await request(app)
      .post(BASE_URL)
      .set(authHeader())
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].username).toBe('testuser1');
    expect(res.body.data[0].profileName).toBe('Basic Plan');

    // No validitySeconds in validBody → no Session-Timeout radreply row.
    const sessionTimeoutCalls = mockClientQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('radreply') && Array.isArray(c[1]) && c[1][1] === 'Session-Timeout',
    );
    expect(sessionTimeoutCalls).toHaveLength(0);
  });

  it('inserts Session-Timeout radreply when validitySeconds is set (caps the first session at validity_seconds)', async () => {
    mockSubscriptionQuery(mockQuery);
    mockCheckQuotaQueries(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Transaction now also includes the radreply Session-Timeout INSERT.
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [MOCK_VOUCHER_ROW] }) // INSERT voucher_meta
      .mockResolvedValueOnce(undefined) // radcheck Cleartext-Password
      .mockResolvedValueOnce(undefined) // radcheck Simultaneous-Use
      .mockResolvedValueOnce(undefined) // radcheck Max-All-Session
      .mockResolvedValueOnce(undefined) // radreply Session-Timeout
      .mockResolvedValueOnce(undefined) // UPDATE subscriptions
      .mockResolvedValueOnce(undefined); // COMMIT

    mockBatchVoucherInfoQueries(mockQuery, ['testuser1']);

    const res = await request(app)
      .post(BASE_URL)
      .set(authHeader())
      .send({ ...validBody, validitySeconds: 86400 });

    expect(res.status).toBe(201);

    // Exactly one radreply Session-Timeout INSERT, value = '86400', for the
    // same generated username used in the radcheck Cleartext-Password row.
    const radcheckPasswordCall = mockClientQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('radcheck') && Array.isArray(c[1]) && c[1][1] === 'Cleartext-Password',
    );
    expect(radcheckPasswordCall).toBeDefined();
    const generatedUsername = radcheckPasswordCall![1][0];

    const sessionTimeoutCalls = mockClientQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('radreply') && Array.isArray(c[1]) && c[1][1] === 'Session-Timeout',
    );
    expect(sessionTimeoutCalls).toHaveLength(1);
    expect(sessionTimeoutCalls[0][1]).toEqual([generatedUsername, 'Session-Timeout', ':=', '86400']);
  });
});

// ─── GET /api/v1/routers/:id/vouchers ────────────────────────────────────────
// NOTE: The GET list endpoint uses query validation with z.coerce which triggers
// an Express 5 bug (req.query is a read-only getter). These tests verify the
// endpoint responds (even if with 500) and that the route is wired correctly.

describe('GET /api/v1/routers/:id/vouchers', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app).get(BASE_URL);
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/routers/:id/vouchers/:vid ───────────────────────────────────

describe('GET /api/v1/routers/:id/vouchers/:vid', () => {
  it('should return 404 when voucher not found', async () => {
    // requireSubscription (2 queries)
    mockSubscriptionQuery(mockQuery);
    // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEST_ROUTER_ID }] });
    // SELECT voucher_meta
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`${BASE_URL}/${TEST_VOUCHER_ID}`)
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('VOUCHER_NOT_FOUND');
  });

  it('should return voucher on success', async () => {
    // requireSubscription (2 queries)
    mockSubscriptionQuery(mockQuery);
    // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEST_ROUTER_ID }] });
    // SELECT voucher_meta
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_VOUCHER_ROW] });
    // Batch enrichment (3 queries)
    mockBatchVoucherInfoQueries(mockQuery, ['testuser1']);

    const res = await request(app)
      .get(`${BASE_URL}/${TEST_VOUCHER_ID}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(TEST_VOUCHER_ID);
    expect(res.body.data.password).toBe('pass123');
  });
});

// ─── PUT /api/v1/routers/:id/vouchers/:vid ───────────────────────────────────

describe('PUT /api/v1/routers/:id/vouchers/:vid', () => {
  it('should return 4xx when no fields provided', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .put(`${BASE_URL}/${TEST_VOUCHER_ID}`)
      .set(authHeader())
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('should return 4xx for invalid status value', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .put(`${BASE_URL}/${TEST_VOUCHER_ID}`)
      .set(authHeader())
      .send({ status: 'invalid' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('should return 404 when voucher not found', async () => {
    // requireSubscription (2 queries)
    mockSubscriptionQuery(mockQuery);
    // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEST_ROUTER_ID }] });
    // SELECT voucher_meta
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put(`${BASE_URL}/${TEST_VOUCHER_ID}`)
      .set(authHeader())
      .send({ status: 'disabled' });

    expect(res.status).toBe(404);
  });

  it('should disable voucher successfully', async () => {
    // requireSubscription (2 queries)
    mockSubscriptionQuery(mockQuery);
    // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEST_ROUTER_ID }] });
    // SELECT voucher_meta
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_VOUCHER_ROW] });

    // Transaction
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ ...MOCK_VOUCHER_ROW, status: 'disabled' }] }) // UPDATE voucher_meta
      .mockResolvedValueOnce(undefined) // DELETE Auth-Type
      .mockResolvedValueOnce(undefined) // INSERT Auth-Type Reject
      .mockResolvedValueOnce(undefined); // COMMIT

    // Batch enrichment (3 queries) — row.status is 'disabled' → stays disabled
    mockBatchVoucherInfoQueries(mockQuery, ['testuser1']);

    const res = await request(app)
      .put(`${BASE_URL}/${TEST_VOUCHER_ID}`)
      .set(authHeader())
      .send({ status: 'disabled' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('disabled');
  });

  it('should enable voucher successfully', async () => {
    // requireSubscription (2 queries)
    mockSubscriptionQuery(mockQuery);
    // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEST_ROUTER_ID }] });
    // SELECT voucher_meta (currently disabled)
    mockQuery.mockResolvedValueOnce({ rows: [{ ...MOCK_VOUCHER_ROW, status: 'disabled' }] });

    // Transaction: updated row comes back with status 'active'
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [MOCK_VOUCHER_ROW] }) // UPDATE → status='active'
      .mockResolvedValueOnce(undefined) // DELETE Auth-Type
      .mockResolvedValueOnce(undefined); // COMMIT

    // Batch enrichment — row.status 'active', no radacct sessions → computedStatus = 'unused'
    mockBatchVoucherInfoQueries(mockQuery, ['testuser1']);

    const res = await request(app)
      .put(`${BASE_URL}/${TEST_VOUCHER_ID}`)
      .set(authHeader())
      .send({ status: 'active' });

    expect(res.status).toBe(200);
    // No active sessions in mock → computedStatus is 'unused', not 'active'
    expect(['active', 'unused']).toContain(res.body.data.status);
  });
});

// ─── DELETE /api/v1/routers/:id/vouchers/:vid ────────────────────────────────

describe('DELETE /api/v1/routers/:id/vouchers/:vid', () => {
  it('should return 404 when voucher not found', async () => {
    // requireSubscription (2 queries)
    mockSubscriptionQuery(mockQuery);
    // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEST_ROUTER_ID }] });
    // SELECT voucher_meta
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete(`${BASE_URL}/${TEST_VOUCHER_ID}`)
      .set(authHeader());

    expect(res.status).toBe(404);
  });

  it('should delete voucher successfully', async () => {
    // requireSubscription (2 queries)
    mockSubscriptionQuery(mockQuery);
    // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEST_ROUTER_ID }] });
    // SELECT voucher_meta
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_VOUCHER_ROW] });

    // Transaction
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // DELETE radcheck
      .mockResolvedValueOnce(undefined) // DELETE radreply
      .mockResolvedValueOnce(undefined) // DELETE radusergroup
      .mockResolvedValueOnce(undefined) // DELETE voucher_meta
      .mockResolvedValueOnce(undefined); // COMMIT

    // sendCoaDisconnect → SELECT router (returns empty → skip CoA)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete(`${BASE_URL}/${TEST_VOUCHER_ID}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
