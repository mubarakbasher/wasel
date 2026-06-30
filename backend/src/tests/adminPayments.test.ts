import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { generateAccessToken } from '../services/token.service';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;
const mockClientQuery = (globalThis as Record<string, unknown>)
  .__mockClientQuery as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Admin identity
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  userId: 'aaaaaaaa-0000-4000-8000-000000000099',
  email: 'admin-pay@example.com',
  name: 'Admin Payments',
  role: 'admin',
};

function adminAuth(): Record<string, string> {
  const token = generateAccessToken(ADMIN_USER);
  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Fixture: a payment row with a receipt (visible in the admin queue)
// ---------------------------------------------------------------------------

const MOCK_PAYMENT_ROW = {
  id: 'pay00000-0000-4000-8000-000000000001',
  user_id: 'u0000000-0000-4000-8000-000000000001',
  amount: 5,
  status: 'pending',
  plan_tier: 'starter',
  currency: 'SDG',
  reference_code: 'REF-001',
  receipt_url: 'https://cdn.wa-sel.com/receipts/r1.jpg',
  rejection_reason: null,
  reviewed_by: null,
  reviewed_at: null,
  created_at: new Date().toISOString(),
  user_name: 'Test User',
  user_email: 'test@example.com',
  plan_name: 'Starter',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Queue two pool.query mock results for a single getPayments call:
 *   1. data query  → rows array
 *   2. count query → [{ count: 'N' }]
 */
function queuePaymentMocks(): void {
  mockQuery.mockResolvedValueOnce({ rows: [MOCK_PAYMENT_ROW] }); // data
  mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });   // count
}

/**
 * Return the pool.query call whose SQL contains `plan_name` — that uniquely
 * identifies the data query (it has the plans JOIN; the count query does not).
 */
function findDataCall(calls: unknown[][]): [string, unknown[]] | undefined {
  return calls.find(
    (c) => typeof c[0] === 'string' && (c[0] as string).includes('plan_name'),
  ) as [string, unknown[]] | undefined;
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
});

const VALID_PAYMENT_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Return the transactional client.query call carrying the payments UPDATE.
 */
function findUpdateCall(calls: unknown[][]): [string, unknown[]] | undefined {
  return calls.find(
    (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE payments'),
  ) as [string, unknown[]] | undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/payments', () => {
  // (a) pending filter: receipt predicate + status predicate both present
  it('(a) pending status — SQL has receipt_url IS NOT NULL and p.status = with "pending" in params', async () => {
    queuePaymentMocks();

    const res = await request(app)
      .get('/api/v1/admin/payments?status=pending')
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dataCall = findDataCall(mockQuery.mock.calls);
    expect(dataCall).toBeDefined();

    const sql = dataCall![0] as string;
    const params = dataCall![1] as unknown[];

    expect(sql).toContain('receipt_url IS NOT NULL');
    expect(sql).toContain('p.status =');
    expect(params).toContain('pending');
  });

  // (b) "all" tab (no status param): receipt predicate present, status predicate absent
  it('(b) no status param — SQL has receipt_url IS NOT NULL but no p.status = predicate', async () => {
    queuePaymentMocks();

    const res = await request(app)
      .get('/api/v1/admin/payments')
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dataCall = findDataCall(mockQuery.mock.calls);
    expect(dataCall).toBeDefined();

    const sql = dataCall![0] as string;

    expect(sql).toContain('receipt_url IS NOT NULL');
    expect(sql).not.toContain('p.status =');
  });

  // (c) plans join and plan_name column present in the data query
  it('(c) data query includes LEFT JOIN plans and selects plan_name', async () => {
    queuePaymentMocks();

    const res = await request(app)
      .get('/api/v1/admin/payments')
      .set(adminAuth());

    expect(res.status).toBe(200);

    const dataCall = findDataCall(mockQuery.mock.calls);
    expect(dataCall).toBeDefined();

    const sql = dataCall![0] as string;

    expect(sql).toContain('LEFT JOIN plans');
    expect(sql).toContain('plan_name');
  });

  // Extra: count query must NOT have the plans join (performance)
  it('count query does not include the plans join', async () => {
    queuePaymentMocks();

    await request(app)
      .get('/api/v1/admin/payments')
      .set(adminAuth());

    const countCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('COUNT(*)'),
    ) as [string, unknown[]] | undefined;

    expect(countCall).toBeDefined();
    expect((countCall![0] as string)).not.toContain('LEFT JOIN plans');
  });

  // Guard: non-admin is rejected
  it('returns 403 for a non-admin user', async () => {
    const res = await request(app)
      .get('/api/v1/admin/payments')
      .set({
        Authorization: `Bearer ${generateAccessToken({
          userId: 'u0000000-0000-4000-8000-000000000001',
          email: 'user@example.com',
          name: 'Regular User',
          role: 'user',
        })}`,
      });

    expect(res.status).toBe(403);
  });

  // Guard: unauthenticated request is rejected
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/payments');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/v1/admin/payments/:id', () => {
  // The action site must enforce the same receipt invariant as the list, so a
  // receipt-less payment can never be approved/rejected via a direct API call.
  it('UPDATE carries the receipt_url IS NOT NULL guard', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...MOCK_PAYMENT_ROW, status: 'rejected' }],
      }) // UPDATE
      .mockResolvedValueOnce({}); // COMMIT

    const res = await request(app)
      .put(`/api/v1/admin/payments/${VALID_PAYMENT_ID}`)
      .set(adminAuth())
      .send({ decision: 'rejected', rejection_reason: 'Receipt unreadable' });

    expect(res.status).toBe(200);

    const updateCall = findUpdateCall(mockClientQuery.mock.calls);
    expect(updateCall).toBeDefined();
    expect(updateCall![0] as string).toContain('receipt_url IS NOT NULL');
    expect(updateCall![0] as string).toContain("status = 'pending'");
  });

  // A receipt-less (or already-reviewed / missing) payment matches zero rows → 404.
  it('returns 404 when the guarded UPDATE matches no row', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // UPDATE (no receipt / already reviewed)
      .mockResolvedValueOnce({}); // ROLLBACK

    const res = await request(app)
      .put(`/api/v1/admin/payments/${VALID_PAYMENT_ID}`)
      .set(adminAuth())
      .send({ decision: 'approved' });

    expect(res.status).toBe(404);
  });
});
