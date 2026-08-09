/**
 * Regression tests for two bugs in getVouchersByRouter cursor pagination:
 *
 *  Bug 1 — cursor precision: nextCursor was truncating to milliseconds via
 *  `new Date(row.created_at).toISOString()`, causing same-µs-timestamp batch
 *  rows to be silently skipped on subsequent pages.
 *
 *  Bug 2 — wrong total in cursor mode: the COUNT query was built AFTER the
 *  cursor predicate was appended to conditions[], so meta.total reflected
 *  remaining rows, not the full collection.
 *
 * Tests 1–4 MUST FAIL against the unpatched code and pass after the fix.
 * Test 5 is a green-from-the-start regression guard.
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

const VOUCHERS_URL = `/api/v1/routers/${TEST_ROUTER_ID}/vouchers`;

/** Microsecond-precision timestamp (what pg returns via to_char). */
const US_TS = '2026-07-01T12:00:00.123456Z';
/** Millisecond-truncated version (what JS Date.toISOString() produces). */
const MS_TS = '2026-07-01T12:00:00.123Z';

/**
 * All rows in a same-timestamp batch share the SAME created_at (ms-truncated,
 * as pg would hydrate into a JS Date) plus the µs-precision created_at_us
 * string returned by the fixed SELECT projection.
 */
function makeBatchRow(id: string, username: string) {
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
    created_at: new Date(MS_TS),
    updated_at: new Date(MS_TS),
    created_at_us: US_TS,
  };
}

/** Mock the two enrichment queries (radcheck + radacct). */
function mockBatchEnrich(mq: ReturnType<typeof vi.fn>, usernames: string[]) {
  mq.mockResolvedValueOnce({
    rows: usernames.map(u => ({ username: u, attribute: 'Cleartext-Password', value: u })),
  });
  mq.mockResolvedValueOnce({ rows: [] }); // radacct — no active sessions
}

beforeEach(() => mockQuery.mockReset());

// ── 1. nextCursor precision on a full offset-mode page ───────────────────────

describe('cursor precision', () => {
  it('nextCursor carries the microsecond-precision timestamp on a full page (offset mode)', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] }); // ownership

    const rows = [
      makeBatchRow('v1', 'u1'),
      makeBatchRow('v2', 'u2'),
      makeBatchRow('v3', 'u3'), // the +1 sentinel
    ];
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] }); // COUNT
    mockQuery.mockResolvedValueOnce({ rows });                    // DATA (limit+1)
    mockBatchEnrich(mockQuery, ['u1', 'u2']);

    const res = await request(app)
      .get(`${VOUCHERS_URL}?limit=2`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.meta.nextCursor).not.toBeNull();

    const decoded = decodeCursor<{ createdAt: string; id: string }>(res.body.meta.nextCursor);
    // PRE-FIX FAILURE: decoded.createdAt === '2026-07-01T12:00:00.123Z'
    expect(decoded.createdAt).toBe(US_TS);
  });

  // ── 2. Cursor-mode page also emits a µs cursor ──────────────────────────────

  it('cursor-mode page emits a microsecond cursor for the next hop', async () => {
    const firstPageCursor = encodeCursor({ createdAt: US_TS, id: 'ffffffff-0000-4000-8000-000000000001' });

    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] }); // ownership
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '4' }] });              // COUNT
    const rows = [
      makeBatchRow('v4', 'u4'),
      makeBatchRow('v5', 'u5'),
      makeBatchRow('v6', 'u6'), // sentinel
    ];
    mockQuery.mockResolvedValueOnce({ rows }); // DATA
    mockBatchEnrich(mockQuery, ['u4', 'u5']);

    const res = await request(app)
      .get(`${VOUCHERS_URL}?limit=2&cursor=${encodeURIComponent(firstPageCursor)}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.meta.nextCursor).not.toBeNull();
    const decoded = decodeCursor<{ createdAt: string; id: string }>(res.body.meta.nextCursor);
    // PRE-FIX FAILURE: decoded.createdAt === '2026-07-01T12:00:00.123Z'
    expect(decoded.createdAt).toBe(US_TS);
  });

  // ── 3. Page-2 DATA query includes created_at_us column + binds µs string ────

  it('page-2 DATA query SELECT contains created_at_us and binds the µs cursor string', async () => {
    const cursorId = 'a1a1a1a1-0000-4000-8000-000000000001';
    const cursor = encodeCursor({ createdAt: US_TS, id: cursorId });

    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] }); // ownership
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });              // COUNT
    mockQuery.mockResolvedValueOnce({ rows: [makeBatchRow('v3', 'u3')] });   // DATA (last page)
    mockBatchEnrich(mockQuery, ['u3']);

    const res = await request(app)
      .get(`${VOUCHERS_URL}?limit=2&cursor=${encodeURIComponent(cursor)}`)
      .set(authHeader());

    expect(res.status).toBe(200);

    const allCalls = mockQuery.mock.calls as Array<[string, unknown[]]>;
    const dataCall = allCalls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('ORDER BY vm.created_at DESC'),
    );
    expect(dataCall).toBeDefined();
    const [dataSql, dataValues] = dataCall!;
    // PRE-FIX FAILURE: pre-fix SELECT is 'SELECT vm.*', no created_at_us column
    expect(dataSql).toContain('created_at_us');
    // The µs cursor string and UUID must both be bound
    expect(dataValues).toContain(US_TS);
    expect(dataValues).toContain(cursorId);
  });

  // ── 4. meta.total uses pre-cursor WHERE (bug 2) ──────────────────────────────

  it('meta.total in cursor mode uses the pre-cursor WHERE clause', async () => {
    const cursorId = 'a1a1a1a1-0000-4000-8000-000000000002';
    const cursor = encodeCursor({ createdAt: US_TS, id: cursorId });

    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] }); // ownership
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '42' }] });             // COUNT (full total)
    mockQuery.mockResolvedValueOnce({ rows: [makeBatchRow('v5', 'u5')] });   // DATA
    mockBatchEnrich(mockQuery, ['u5']);

    const res = await request(app)
      .get(`${VOUCHERS_URL}?limit=2&cursor=${encodeURIComponent(cursor)}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(42);

    const allCalls = mockQuery.mock.calls as Array<[string, unknown[]]>;
    const countCall = allCalls.find(
      ([sql]) => typeof sql === 'string' && (sql as string).startsWith('SELECT COUNT(*)'),
    );
    expect(countCall).toBeDefined();
    const [countSql, countValues] = countCall!;
    // PRE-FIX FAILURE: pre-fix COUNT SQL contains the cursor predicate
    expect(countSql).not.toContain('vm.created_at < $');
    // Pre-cursor values: only userId + routerId (length 2 with no extra filters)
    expect((countValues as unknown[]).length).toBe(2);
    expect(countValues).not.toContain(US_TS);
    expect(countValues).not.toContain(cursorId);
  });

  // ── 5. Legacy ms-precision cursor accepted without 422 (green from start) ───

  it('accepts a legacy millisecond-precision cursor without returning 422', async () => {
    const cursorId = 'a1a1a1a1-0000-4000-8000-000000000003';
    const cursor = encodeCursor({ createdAt: MS_TS, id: cursorId });

    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] }); // ownership
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });              // COUNT
    mockQuery.mockResolvedValueOnce({ rows: [makeBatchRow('v9', 'u9')] });   // DATA
    mockBatchEnrich(mockQuery, ['u9']);

    const res = await request(app)
      .get(`${VOUCHERS_URL}?limit=2&cursor=${encodeURIComponent(cursor)}`)
      .set(authHeader());

    expect(res.status).toBe(200);
  });

  // ── 6. Crafted cursor payloads → 422, not a 500 at the SQL cast ─────────────

  const badPayloads: Array<[string, { createdAt: string; id: string }]> = [
    ['non-timestamp createdAt', { createdAt: 'not-a-ts', id: 'a1a1a1a1-0000-4000-8000-000000000004' }],
    ['calendar-overflow createdAt', { createdAt: '2026-02-31T00:00:00.000Z', id: 'a1a1a1a1-0000-4000-8000-000000000004' }],
    ['non-uuid id', { createdAt: MS_TS, id: 'not-a-uuid' }],
  ];

  it.each(badPayloads)(
    'returns 422 INVALID_CURSOR for a crafted cursor with %s',
    async (_label, payload) => {
      mockSubscriptionQuery(mockQuery);
      mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] }); // ownership

      const res = await request(app)
        .get(`${VOUCHERS_URL}?limit=2&cursor=${encodeURIComponent(encodeCursor(payload))}`)
        .set(authHeader());

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_CURSOR');
    },
  );
});
