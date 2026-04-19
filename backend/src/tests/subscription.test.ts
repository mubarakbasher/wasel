import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { TEST_USER, authHeader, ACTIVE_SUBSCRIPTION_ROW } from './helpers';

// Mock the upload middleware so the receipt route behaves as if a file was
// successfully uploaded; tests can then focus on service-level logic.
vi.mock('../middleware/upload', () => ({
  uploadReceipt: {
    single: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
      req.file = {
        filename: 'test-receipt.jpg',
        path: '/tmp/test-receipt.jpg',
        mimetype: 'image/jpeg',
      };
      next();
    },
  },
  verifyUploadMagicBytes: (_req: unknown, _res: unknown, next: () => void) => next(),
  RECEIPTS_PUBLIC_PREFIX: '/uploads/receipts',
}));

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof import('vitest').vi.fn>;
const mockClientQuery = (globalThis as Record<string, unknown>).__mockClientQuery as ReturnType<typeof import('vitest').vi.fn>;

// A minimal plan row returned by getPlanByTier — used wherever the service
// calls SELECT * FROM plans inside requestSubscription / toSubscriptionInfo.
const STARTER_PLAN_ROW = {
  id: 'plan-starter',
  tier: 'starter',
  name: 'Starter',
  price: '5',
  currency: 'SDG',
  max_routers: 1,
  monthly_vouchers: 500,
  session_monitoring: null,
  dashboard: null,
  features: [],
  allowed_durations: [1],
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
};

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
});

// ─── GET /api/v1/subscription/plans ──────────────────────────────────────────

const ALL_PLAN_ROWS = [
  STARTER_PLAN_ROW,
  {
    ...STARTER_PLAN_ROW,
    id: 'plan-professional',
    tier: 'professional',
    name: 'Professional',
    price: '15',
    max_routers: 3,
    monthly_vouchers: 2000,
    allowed_durations: [1, 3, 6],
  },
  {
    ...STARTER_PLAN_ROW,
    id: 'plan-enterprise',
    tier: 'enterprise',
    name: 'Enterprise',
    price: '50',
    max_routers: 10,
    monthly_vouchers: -1,
    allowed_durations: [1, 3, 6, 12],
  },
];

describe('GET /api/v1/subscription/plans', () => {
  it('should return all plan definitions (public, no auth required)', async () => {
    // getPlans() → SELECT * FROM plans
    mockQuery.mockResolvedValueOnce({ rows: ALL_PLAN_ROWS });

    const res = await request(app).get('/api/v1/subscription/plans');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(3);

    const tiers = res.body.data.map((p: any) => p.tier);
    expect(tiers).toContain('starter');
    expect(tiers).toContain('professional');
    expect(tiers).toContain('enterprise');
  });

  it('should include pricing and limits in plan data', async () => {
    // getPlans() → SELECT * FROM plans
    mockQuery.mockResolvedValueOnce({ rows: ALL_PLAN_ROWS });

    const res = await request(app).get('/api/v1/subscription/plans');

    const starter = res.body.data.find((p: any) => p.tier === 'starter');
    expect(starter.price).toBe(5);
    expect(starter.maxRouters).toBe(1);
    expect(starter.monthlyVouchers).toBe(500);
  });
});

// ─── GET /api/v1/subscription ────────────────────────────────────────────────

describe('GET /api/v1/subscription', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app).get('/api/v1/subscription');
    expect(res.status).toBe(401);
  });

  it('should return null when user has no subscription', async () => {
    // getCurrentSubscription query
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/v1/subscription')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeNull();
  });

  it('should return active subscription details', async () => {
    // getCurrentSubscription → SELECT subscriptions
    mockQuery.mockResolvedValueOnce({ rows: [ACTIVE_SUBSCRIPTION_ROW] });
    // toSubscriptionInfo → getPlanByTier → SELECT plans
    mockQuery.mockResolvedValueOnce({ rows: [STARTER_PLAN_ROW] });

    const res = await request(app)
      .get('/api/v1/subscription')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.planTier).toBe('starter');
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.voucherQuota).toBe(500);
  });

  it('should auto-expire subscription past end_date', async () => {
    const expiredRow = {
      ...ACTIVE_SUBSCRIPTION_ROW,
      end_date: new Date(Date.now() - 86400000), // yesterday
    };
    // getCurrentSubscription SELECT
    mockQuery.mockResolvedValueOnce({ rows: [expiredRow] });
    // UPDATE to expired
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .get('/api/v1/subscription')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });
});

// ─── POST /api/v1/subscription/request ───────────────────────────────────────

describe('POST /api/v1/subscription/request', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/subscription/request')
      .send({ planTier: 'starter' });
    expect(res.status).toBe(401);
  });

  it('should return 400 for invalid plan tier', async () => {
    // requestSubscription calls getPlanByTier first → returns null for unknown tier
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/v1/subscription/request')
      .set(authHeader())
      .send({ planTier: 'invalid' });

    expect(res.status).toBe(400);
  });

  it('should return 409 when user already has active subscription', async () => {
    // requestSubscription: getPlanByTier → SELECT plans (must come first)
    mockQuery.mockResolvedValueOnce({ rows: [STARTER_PLAN_ROW] });
    // Then: SELECT existing subscriptions
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'sub-1', status: 'active' }] });

    const res = await request(app)
      .post('/api/v1/subscription/request')
      .set(authHeader())
      .send({ planTier: 'starter' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUBSCRIPTION_ACTIVE');
  });

  it('should return 409 when user has pending subscription', async () => {
    // getPlanByTier first, then existing-sub check
    mockQuery.mockResolvedValueOnce({ rows: [STARTER_PLAN_ROW] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'sub-1', status: 'pending' }] });

    const res = await request(app)
      .post('/api/v1/subscription/request')
      .set(authHeader())
      .send({ planTier: 'starter' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUBSCRIPTION_PENDING');
  });

  it('should create subscription and payment on success', async () => {
    // getPlanByTier first
    mockQuery.mockResolvedValueOnce({ rows: [STARTER_PLAN_ROW] });
    // Check existing: none
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const futureDate = new Date(Date.now() + 30 * 86400000);
    const now = new Date();

    // Transaction: BEGIN, INSERT subscription, INSERT payment, COMMIT
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({
        rows: [{
          id: 'sub-new',
          user_id: TEST_USER.userId,
          plan_tier: 'starter',
          start_date: now,
          end_date: futureDate,
          status: 'pending',
          voucher_quota: 500,
          vouchers_used: 0,
          duration_months: 1,
          previous_subscription_id: null,
          created_at: now,
          updated_at: now,
        }],
      }) // INSERT subscription
      .mockResolvedValueOnce({
        rows: [{
          id: 'pay-new',
          amount: '5',
          currency: 'SDG',
          reference_code: 'WAS-TESTTEST',
          status: 'pending',
        }],
      }) // INSERT payment
      .mockResolvedValueOnce(undefined); // COMMIT

    // toSubscriptionInfo → getPlanByTier called after COMMIT on the new subscription row
    mockQuery.mockResolvedValueOnce({ rows: [STARTER_PLAN_ROW] });

    const res = await request(app)
      .post('/api/v1/subscription/request')
      .set(authHeader())
      .send({ planTier: 'starter' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.subscription.planTier).toBe('starter');
    expect(res.body.data.payment.referenceCode).toBeDefined();
    expect(res.body.data.payment.amount).toBe(5);
  });
});

// ─── POST /api/v1/subscription/receipt ───────────────────────────────────────

describe('POST /api/v1/subscription/receipt', () => {
  const validPaymentId = '550e8400-e29b-41d4-a716-446655440099';

  it('should return 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/subscription/receipt')
      .send({ paymentId: validPaymentId, receiptUrl: 'https://example.com/receipt.png' });
    expect(res.status).toBe(401);
  });

  it('should return 400 for invalid paymentId format', async () => {
    // Zod schema validates paymentId as UUID — non-UUID string fails validation
    const res = await request(app)
      .post('/api/v1/subscription/receipt')
      .set(authHeader())
      .send({ paymentId: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for missing paymentId', async () => {
    const res = await request(app)
      .post('/api/v1/subscription/receipt')
      .set(authHeader())
      .send({});

    expect(res.status).toBe(400);
  });

  it('should return 404 when payment not found', async () => {
    // uploadReceipt service: SELECT payment
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/v1/subscription/receipt')
      .set(authHeader())
      .send({ paymentId: validPaymentId });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PAYMENT_NOT_FOUND');
  });

  it('should return 403 when payment belongs to another user', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: validPaymentId, user_id: 'other-user-id', status: 'pending' }],
    });

    const res = await request(app)
      .post('/api/v1/subscription/receipt')
      .set(authHeader())
      .send({ paymentId: validPaymentId });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PAYMENT_FORBIDDEN');
  });

  it('should return 400 when payment is not pending', async () => {
    // The service rejects any status other than 'pending' or 'rejected'
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: validPaymentId, user_id: TEST_USER.userId, status: 'approved' }],
    });

    const res = await request(app)
      .post('/api/v1/subscription/receipt')
      .set(authHeader())
      .send({ paymentId: validPaymentId });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAYMENT_NOT_RESUBMITTABLE');
  });

  it('should upload receipt successfully', async () => {
    // SELECT payment
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: validPaymentId, user_id: TEST_USER.userId, status: 'pending' }],
    });
    // UPDATE payment
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .post('/api/v1/subscription/receipt')
      .set(authHeader())
      .send({ paymentId: validPaymentId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
