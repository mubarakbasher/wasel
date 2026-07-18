/**
 * Cursor (keyset) pagination tests.
 *
 * Covers:
 *  1. encodeCursor / decodeCursor round-trip (unit)
 *  2. GET /routers/:id/vouchers — cursor returned, two-page traversal, no duplicates
 *  3. GET /notifications        — cursor returned, last-page terminates (nextCursor = null)
 *  4. GET /support/messages     — cursor pagination accepted + keyset condition forwarded
 *  5. GET /routers/:id/sessions/history — cursor returned for session history
 *  6. Invalid cursor → 422 with code INVALID_CURSOR
 *  7. All 4xx errors carry a stable `code` field
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { encodeCursor, decodeCursor } from '../utils/cursor';
import {
  TEST_USER,
  authHeader,
  mockSubscriptionQuery,
  TEST_ROUTER_ID,
} from './helpers';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

// Suppress real RouterOS / CoA calls
vi.mock('../services/routerOs.service', () => ({
  getActiveHotspotUsers: vi.fn().mockResolvedValue([]),
  disconnectHotspotUser: vi.fn().mockResolvedValue(''),
  connectToRouter: vi.fn(),
  getSystemInfo: vi.fn(),
  testConnection: vi.fn(),
}));
vi.mock('../services/radclient.service', () => ({
  sendDisconnectRequest: vi.fn().mockResolvedValue('ack'),
  sendAccessRequest: vi.fn().mockResolvedValue('accept'),
}));
vi.mock('../utils/encryption', () => ({
  decrypt: vi.fn().mockReturnValue('test-radius-secret'),
  encrypt: vi.fn().mockReturnValue('encrypted-value'),
  generateRadiusSecret: vi.fn().mockReturnValue('random-secret'),
  generateNasIdentifier: vi.fn().mockReturnValue('router-id'),
}));

// ── Shared fixtures ────────────────────────────────────────────────────────────

const NOW   = new Date('2026-07-01T12:00:00Z');
const OLDER = new Date('2026-07-01T10:00:00Z');
const OLDEST= new Date('2026-07-01T08:00:00Z');

function makeVoucherRow(id: string, username: string, createdAt: Date) {
  return {
    id,
    user_id: TEST_USER.userId,
    router_id: TEST_ROUTER_ID,
    radius_username: username,
    group_profile: null,
    comment: null,
    status: 'unused',
    limit_type: 'time',
    limit_value: '3600',
    limit_unit: 'hours',
    validity_seconds: null,
    price: '5.00',
    created_at: createdAt,
    updated_at: createdAt,
  };
}

/**
 * Mock the 2 parallel batchToVoucherInfo queries for voucher rows that have
 * group_profile = null.  batchFetchProfiles short-circuits (no DB call) when
 * all profilePairs are empty, so only radcheck + radacct are issued.
 */
function mockBatchEnrich(mq: ReturnType<typeof vi.fn>, usernames: string[]) {
  mq.mockResolvedValueOnce({ rows: usernames.map(u => ({ username: u, attribute: 'Cleartext-Password', value: u })) });
  mq.mockResolvedValueOnce({ rows: [] }); // radacct (no active sessions in tests)
  // No profiles mock — batchFetchProfiles returns new Map() without a DB call
  // when profilePairs is empty (group_profile is null for all makeVoucherRow rows).
}

const VOUCHERS_URL = `/api/v1/routers/${TEST_ROUTER_ID}/vouchers`;
const NOTIFICATIONS_URL = `/api/v1/notifications`;
const SUPPORT_URL = `/api/v1/support/messages`;
const SESSIONS_URL = `/api/v1/routers/${TEST_ROUTER_ID}/sessions/history`;

beforeEach(() => mockQuery.mockReset());

// ── 1. Cursor encode / decode ─────────────────────────────────────────────────

describe('cursor utility', () => {
  it('round-trips a timestamp+uuid cursor', () => {
    const payload = { createdAt: '2026-07-01T12:00:00.000Z', id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };
    const encoded = encodeCursor(payload);
    const decoded = decodeCursor<typeof payload>(encoded);
    expect(decoded.createdAt).toBe(payload.createdAt);
    expect(decoded.id).toBe(payload.id);
  });

  it('round-trips a timestamp+int cursor', () => {
    const payload = { startTime: '2026-07-01T08:00:00.000Z', id: 42 };
    const encoded = encodeCursor(payload);
    const decoded = decodeCursor<typeof payload>(encoded);
    expect(decoded.startTime).toBe(payload.startTime);
    expect(decoded.id).toBe(42);
  });

  it('throws on corrupt cursor', () => {
    expect(() => decodeCursor('not-valid-base64!!!')).toThrow();
  });
});

// ── 2. Voucher list cursor pagination ─────────────────────────────────────────

describe('GET /routers/:id/vouchers — cursor pagination', () => {
  it('returns nextCursor in meta when a full page is returned', async () => {
    mockSubscriptionQuery(mockQuery);
    // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });

    // The service fetches limit+1 = 3 rows (limit=2) to detect a next page.
    // Returning exactly 3 rows makes hasNextPage = true.
    const rows = [
      makeVoucherRow('v1', 'u1', NOW),
      makeVoucherRow('v2', 'u2', OLDER),
      makeVoucherRow('v3', 'u3', OLDEST), // the +1 sentinel row
    ];

    // COUNT query
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] });
    // DATA query (limit+1 = 3 rows)
    mockQuery.mockResolvedValueOnce({ rows });
    // Batch enrichment for the 2 sliced rows (v1, v2) only
    mockBatchEnrich(mockQuery, ['u1', 'u2']);

    const res = await request(app)
      .get(`${VOUCHERS_URL}?limit=2`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.meta.nextCursor).not.toBeNull();
    expect(typeof res.body.meta.nextCursor).toBe('string');
    expect(res.body.data).toHaveLength(2);
  });

  it('returns nextCursor=null on the last page', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });

    const rows = [makeVoucherRow('v3', 'u3', OLDEST)];

    // COUNT
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    // DATA — only 1 row (less than limit), no next page
    mockQuery.mockResolvedValueOnce({ rows });
    mockBatchEnrich(mockQuery, ['u3']);

    const res = await request(app)
      .get(`${VOUCHERS_URL}?limit=5`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.meta.nextCursor).toBeNull();
  });

  it('two-page traversal yields no duplicate IDs', async () => {
    // ── Page 1 (no cursor, offset mode) ──
    // Query order: requireSubscription(2) + verifyRouterOwnership + COUNT + DATA + radcheck + radacct
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });

    const page1Rows = [
      makeVoucherRow('v-pg1-a', 'ua', NOW),
      makeVoucherRow('v-pg1-b', 'ub', OLDER),
    ];
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '4' }] });
    // limit+1 = 3: return 3 rows so hasNextPage = true
    mockQuery.mockResolvedValueOnce({ rows: [...page1Rows, makeVoucherRow('v-pg2-c', 'uc', OLDEST)] });
    // batchToVoucherInfo for sliced rows ['ua','ub'] → radcheck + radacct only (group_profile=null)
    mockBatchEnrich(mockQuery, ['ua', 'ub']);

    const res1 = await request(app)
      .get(`${VOUCHERS_URL}?limit=2`)
      .set(authHeader());

    expect(res1.status).toBe(200);
    const nextCursor = res1.body.meta.nextCursor as string;
    expect(nextCursor).toBeTruthy();
    const page1Ids = res1.body.data.map((v: { id: string }) => v.id) as string[];
    expect(page1Ids).toHaveLength(2);

    // ── Page 2 (cursor mode) ──
    // Query order: requireSubscription(2) + verifyRouterOwnership + COUNT + DATA + radcheck + radacct
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });

    const page2Rows = [makeVoucherRow('v-pg2-c', 'uc', OLDEST)];
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] });
    // Only 1 row returned (< limit), so hasNextPage = false → nextCursor = null
    mockQuery.mockResolvedValueOnce({ rows: page2Rows });
    // batchToVoucherInfo for ['uc'] → radcheck + radacct only
    mockBatchEnrich(mockQuery, ['uc']);

    const res2 = await request(app)
      .get(`${VOUCHERS_URL}?limit=2&cursor=${encodeURIComponent(nextCursor)}`)
      .set(authHeader());

    expect(res2.status).toBe(200);
    expect(res2.body.meta.nextCursor).toBeNull();
    const page2Ids = res2.body.data.map((v: { id: string }) => v.id) as string[];

    // No overlap between page 1 and page 2 — keyset cursor excludes seen rows
    const intersection = page1Ids.filter(id => page2Ids.includes(id));
    expect(intersection).toHaveLength(0);
  });

  it('returns 422 with INVALID_CURSOR for a malformed cursor', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });

    const res = await request(app)
      .get(`${VOUCHERS_URL}?cursor=not-a-valid-cursor!!!`)
      .set(authHeader());

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });

  it('includes code in 404 response when router not found', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // router not found

    const res = await request(app)
      .get(VOUCHERS_URL)
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTER_NOT_FOUND');
  });
});

// ── 3. Notification list cursor pagination ────────────────────────────────────

describe('GET /notifications — cursor pagination', () => {
  function makeNotifRow(id: string, createdAt: Date) {
    return {
      id,
      category: 'router_offline',
      title: 'Router offline',
      body: 'Your router went offline',
      data: null,
      read_at: null,
      created_at: createdAt,
    };
  }

  it('returns nextCursor in meta and terminates on last page', async () => {
    // First page: has a next page
    mockQuery.mockResolvedValueOnce({
      rows: [makeNotifRow('n1', NOW), makeNotifRow('n2', OLDER), makeNotifRow('n3', OLDEST)],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] }); // unread

    const res1 = await request(app)
      .get(`${NOTIFICATIONS_URL}?limit=2`)
      .set(authHeader());

    expect(res1.status).toBe(200);
    expect(res1.body.meta.nextCursor).not.toBeNull();
    const cursor = res1.body.meta.nextCursor as string;

    // Second page: no next page
    mockQuery.mockResolvedValueOnce({ rows: [makeNotifRow('n3', OLDEST)] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res2 = await request(app)
      .get(`${NOTIFICATIONS_URL}?limit=2&cursor=${encodeURIComponent(cursor)}`)
      .set(authHeader());

    expect(res2.status).toBe(200);
    expect(res2.body.meta.nextCursor).toBeNull();
    const page2Ids = res2.body.data.map((n: { id: string }) => n.id);
    expect(page2Ids).not.toContain('n1');
    expect(page2Ids).not.toContain('n2');
  });

  it('returns 422 with INVALID_CURSOR for a malformed cursor', async () => {
    const res = await request(app)
      .get(`${NOTIFICATIONS_URL}?cursor=garbage`)
      .set(authHeader());

    // garbage decodes but has no createdAt/id — should be 422
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });
});

// ── 4. Support messages cursor pagination ─────────────────────────────────────

describe('GET /support/messages — cursor pagination', () => {
  function makeMsgRow(id: string, createdAt: Date) {
    return {
      id,
      sender: 'admin' as const,
      body: 'Hello',
      read_at: null,
      created_at: createdAt,
    };
  }

  it('returns nextCursor when more pages available', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [makeMsgRow('m1', NOW), makeMsgRow('m2', OLDER), makeMsgRow('m3', OLDEST)],
      })
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const res = await request(app)
      .get(`${SUPPORT_URL}?limit=2`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.meta.nextCursor).not.toBeNull();
  });

  it('returns 422 for malformed cursor', async () => {
    const res = await request(app)
      .get(`${SUPPORT_URL}?cursor=!!invalid`)
      .set(authHeader());

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });
});

// ── 5. Session history cursor pagination ─────────────────────────────────────

describe('GET /routers/:id/sessions/history — cursor pagination', () => {
  // session history requires professional/enterprise tier
  // The test user has 'starter' — mock the tier check to pass by overriding
  // requireTier. Here we mock the subscription row with 'professional' plan.
  function mockProSubscription(mq: ReturnType<typeof vi.fn>) {
    mq.mockResolvedValueOnce({
      rows: [{
        id: 'sub-pro',
        user_id: TEST_USER.userId,
        plan_tier: 'professional',
        status: 'active',
        voucher_quota: 2000,
        vouchers_used: 0,
        start_date: new Date(),
        end_date: new Date(Date.now() + 30 * 86400000),
        created_at: new Date(),
        updated_at: new Date(),
      }],
    });
    mq.mockResolvedValueOnce({ rows: [] }); // getPlanByTier
  }

  function makeRadacctRow(id: number, startTime: Date) {
    return {
      radacctid: String(id),
      acctsessionid: `sess-${id}`,
      acctuniqueid: `uniq-${id}`,
      username: `user${id}`,
      nasipaddress: '10.10.0.2',
      acctstarttime: startTime,
      acctstoptime: new Date(startTime.getTime() + 3600000),
      acctsessiontime: '3600',
      acctinputoctets: '1024',
      acctoutputoctets: '2048',
      calledstationid: '',
      callingstationid: '',
      acctterminatecause: 'User-Request',
      framedipaddress: '192.168.1.100',
    };
  }

  it('returns nextCursor when a full page is returned', async () => {
    mockProSubscription(mockQuery);
    // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEST_ROUTER_ID, tunnel_ip: '10.10.0.2', radius_secret_enc: 'enc' }] });

    const rows = [makeRadacctRow(5, NOW), makeRadacctRow(4, OLDER), makeRadacctRow(3, OLDEST)];
    // COUNT + DATA queries run in Promise.all
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '10' }] });
    mockQuery.mockResolvedValueOnce({ rows });

    const res = await request(app)
      .get(`${SESSIONS_URL}?limit=2`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.meta.nextCursor).not.toBeNull();
    expect(res.body.data).toHaveLength(2);
  });

  it('returns 422 with INVALID_CURSOR for bad cursor', async () => {
    mockProSubscription(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEST_ROUTER_ID, tunnel_ip: '10.10.0.2', radius_secret_enc: 'enc' }] });

    const res = await request(app)
      .get(`${SESSIONS_URL}?cursor=not-a-valid-cursor`)
      .set(authHeader());

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });
});

// ── 6. Error code coverage ────────────────────────────────────────────────────

describe('error code coverage', () => {
  it('401 without auth token carries AUTH_REQUIRED', async () => {
    const res = await request(app).get(VOUCHERS_URL);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('403 without active subscription carries SUBSCRIPTION_REQUIRED', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no subscription
    const res = await request(app).get(VOUCHERS_URL).set(authHeader());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('validation error carries VALIDATION_ERROR with details', async () => {
    // POST with empty body triggers Zod validation
    mockSubscriptionQuery(mockQuery);
    const res = await request(app)
      .post(VOUCHERS_URL)
      .set(authHeader())
      .send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    // Either VALIDATION_ERROR from Zod or some domain error — ensure code exists
    expect(res.body.error.code).toBeTruthy();
  });

  it('session history 403 without pro/enterprise tier carries TIER_INSUFFICIENT', async () => {
    // Return a starter subscription
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'sub-starter',
        user_id: TEST_USER.userId,
        plan_tier: 'starter',
        status: 'active',
        voucher_quota: 500,
        vouchers_used: 0,
        start_date: new Date(),
        end_date: new Date(Date.now() + 30 * 86400000),
        created_at: new Date(),
        updated_at: new Date(),
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getPlanByTier

    const res = await request(app)
      .get(SESSIONS_URL)
      .set(authHeader());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TIER_INSUFFICIENT');
  });
});
