/**
 * Tests for:
 *  A2a — GET /routers/:id/vouchers/batches (new endpoint)
 *  A2b — GET /routers/:id/vouchers?batch=<key> (batch filter on list endpoint)
 *  A2c — POST /routers/:id/vouchers/bulk-delete with filter.batch
 *  A2d — Zod validation of batchKey format in query / body
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { encodeCursor } from '../utils/cursor';
import {
  TEST_USER,
  authHeader,
  mockSubscriptionQuery,
  TEST_ROUTER_ID,
} from './helpers';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

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

const BATCHES_URL = `/api/v1/routers/${TEST_ROUTER_ID}/vouchers/batches`;
const VOUCHERS_URL = `/api/v1/routers/${TEST_ROUTER_ID}/vouchers`;
const BULK_DELETE_URL = `/api/v1/routers/${TEST_ROUTER_ID}/vouchers/bulk-delete`;

/** A well-formed µs-precision batch key. */
const VALID_BATCH_KEY = '2026-08-09T10:11:12.123456Z';

/** A raw batch result row as pg would return it. */
function makeBatchDbRow(batchKey: string, overrides: Partial<{
  limit_value: string;
  price: string;
  count: number;
}> = {}) {
  return {
    batch_key: batchKey,
    created_at: new Date('2026-08-09T10:11:12.123Z'),
    count: overrides.count ?? 3000,
    limit_type: 'time',
    limit_value: overrides.limit_value ?? '3600',
    limit_unit: 'hours',
    validity_seconds: null,
    price: overrides.price ?? '5.00',
  };
}

/** Mock the two enrichment queries (radcheck + radacct). */
function mockBatchEnrich(mq: ReturnType<typeof vi.fn>, usernames: string[]) {
  mq.mockResolvedValueOnce({
    rows: usernames.map(u => ({ username: u, attribute: 'Cleartext-Password', value: u })),
  });
  mq.mockResolvedValueOnce({ rows: [] });
}

/** Minimal voucher_meta row returned by the list endpoint. */
function makeVoucherRow(id: string, username: string) {
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
    created_at: new Date('2026-08-09T10:11:12.123Z'),
    updated_at: new Date('2026-08-09T10:11:12.123Z'),
    created_at_us: VALID_BATCH_KEY,
  };
}

beforeEach(() => mockQuery.mockReset());

// ── 1. Happy-path: grouped rows with string numerics are parsed correctly ─────

describe('GET /vouchers/batches', () => {
  it('returns creation groups newest-first with parsed numerics', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] }); // ownership
    mockQuery.mockResolvedValueOnce({
      rows: [makeBatchDbRow(VALID_BATCH_KEY, { limit_value: '3600', price: '5.00', count: 3000 })],
    }); // batches query

    const res = await request(app)
      .get(BATCHES_URL)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);

    const batch = res.body.data[0];
    // batchKey must match the µs-precision format
    expect(batch.batchKey).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    expect(batch.batchKey).toBe(VALID_BATCH_KEY);
    // Numerics should be parsed (not strings)
    expect(batch.limitValue).toBe(3600);
    expect(batch.price).toBe(5);
    expect(batch.count).toBe(3000);
    expect(typeof batch.limitValue).toBe('number');
    expect(typeof batch.price).toBe('number');
  });

  // ── 2. Empty array when no vouchers ────────────────────────────────────────

  it('returns empty array when router has no vouchers', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] }); // ownership
    mockQuery.mockResolvedValueOnce({ rows: [] }); // batches query — no vouchers

    const res = await request(app)
      .get(BATCHES_URL)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  // ── 3. 404 when router not owned by user ────────────────────────────────────

  it('returns 404 ROUTER_NOT_FOUND for a router not owned by the user', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ownership — no rows

    const res = await request(app)
      .get(BATCHES_URL)
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTER_NOT_FOUND');
  });

  // ── 4. 400 VALIDATION_ERROR when limit > 200 ────────────────────────────────

  it('returns 400 VALIDATION_ERROR when limit > 200', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] }); // ownership

    const res = await request(app)
      .get(`${BATCHES_URL}?limit=201`)
      .set(authHeader());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── 5. GET /vouchers?batch=<key> adds vm.created_at = $ to the data query ────

describe('GET /vouchers?batch=<key>', () => {
  it('adds vm.created_at = $ to the data-query SQL and binds the batch key', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] }); // ownership
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] });              // COUNT
    mockQuery.mockResolvedValueOnce({ rows: [makeVoucherRow('v1', 'u1')] }); // DATA
    mockBatchEnrich(mockQuery, ['u1']);

    const res = await request(app)
      .get(`${VOUCHERS_URL}?batch=${encodeURIComponent(VALID_BATCH_KEY)}`)
      .set(authHeader());

    expect(res.status).toBe(200);

    const allCalls = mockQuery.mock.calls as Array<[string, unknown[]]>;
    const dataCall = allCalls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('ORDER BY vm.created_at DESC'),
    );
    expect(dataCall).toBeDefined();
    const [dataSql, dataValues] = dataCall!;
    expect(dataSql).toContain('vm.created_at = $');
    expect(dataValues).toContain(VALID_BATCH_KEY);
  });

  // ── 6. batch + cursor compose (both predicates present in SQL) ───────────────

  it('batch and cursor compose — both predicates appear in the DATA query SQL', async () => {
    const cursorId = 'a2a2a2a2-0000-4000-8000-000000000001';
    const cursor = encodeCursor({ createdAt: VALID_BATCH_KEY, id: cursorId });

    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] }); // ownership
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });              // COUNT (pre-cursor)
    mockQuery.mockResolvedValueOnce({ rows: [makeVoucherRow('v9', 'u9')] }); // DATA
    mockBatchEnrich(mockQuery, ['u9']);

    const res = await request(app)
      .get(`${VOUCHERS_URL}?batch=${encodeURIComponent(VALID_BATCH_KEY)}&cursor=${encodeURIComponent(cursor)}`)
      .set(authHeader());

    expect(res.status).toBe(200);

    const allCalls = mockQuery.mock.calls as Array<[string, unknown[]]>;
    const dataCall = allCalls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('ORDER BY vm.created_at DESC'),
    );
    expect(dataCall).toBeDefined();
    const [dataSql] = dataCall!;
    // Both the batch equality predicate and the cursor keyset predicate must be present
    expect(dataSql).toContain('vm.created_at = $');
    expect(dataSql).toContain('vm.created_at < $');
  });
});

// ── 7. Zod validation rejects malformed batch keys ────────────────────────────

describe('batch key Zod validation', () => {
  const badKeys = [
    '2026-08-09 10:11',              // space instead of T, no seconds/µs/Z
    '2026-08-09T10:11:12.123456+00', // offset notation instead of Z
    '2026-08-09T10:11:12.123Z',      // only milliseconds — not 6 digits
    'not-a-timestamp',
    '2026-13-01T00:00:00.000000Z',   // regex-shaped but month out of range
    '2026-02-31T00:00:00.000000Z',   // regex-shaped but invalid calendar date
    '2026-08-09T25:00:00.000000Z',   // regex-shaped but hour out of range
  ];

  it.each(badKeys)(
    'returns 400 VALIDATION_ERROR for malformed batch key: %s',
    async (badKey) => {
      mockSubscriptionQuery(mockQuery);
      mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });

      const res = await request(app)
        .get(`${VOUCHERS_URL}?batch=${encodeURIComponent(badKey)}`)
        .set(authHeader());

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    },
  );
});

// ── 8. bulk-delete filter mode accepts batch ──────────────────────────────────

describe('POST /vouchers/bulk-delete — filter.batch', () => {
  it('filter-mode SELECT contains vm.created_at = $ when batch is provided', async () => {
    const mockClientQuery = (globalThis as Record<string, unknown>).__mockClientQuery as ReturnType<typeof vi.fn>;

    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] }); // ownership

    // filter-mode SELECT returns one row to delete
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'v1', radius_username: 'u1' }],
    });

    // Transaction queries on the client mock
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // DELETE radcheck
      .mockResolvedValueOnce({ rows: [] }) // DELETE radreply
      .mockResolvedValueOnce({ rows: [] }) // DELETE radusergroup
      .mockResolvedValueOnce({ rows: [] }) // DELETE voucher_meta
      .mockResolvedValueOnce({ rows: [] }) // UPDATE subscriptions
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = await request(app)
      .post(BULK_DELETE_URL)
      .set(authHeader())
      .send({ filter: { batch: VALID_BATCH_KEY } });

    expect(res.status).toBe(200);
    expect(res.body.data.deletedCount).toBe(1);

    // Verify the filter-mode SELECT used the batch predicate
    const allCalls = mockQuery.mock.calls as Array<[string, unknown[]]>;
    const filterSelectCall = allCalls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('vm.radius_username') && sql.includes('LIMIT 500'),
    );
    expect(filterSelectCall).toBeDefined();
    const [filterSql, filterValues] = filterSelectCall!;
    expect(filterSql).toContain('vm.created_at = $');
    expect(filterValues).toContain(VALID_BATCH_KEY);
  });
});
