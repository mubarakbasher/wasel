import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { TEST_USER, authHeader, ACTIVE_SUBSCRIPTION_ROW } from './helpers';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof import('vitest').vi.fn>;
const mockClientQuery = (globalThis as Record<string, unknown>).__mockClientQuery as ReturnType<typeof import('vitest').vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
});

// ─── GET /api/v1/subscription/plans ──────────────────────────────────────────

describe('GET /api/v1/subscription/plans', () => {
  it('should return all plan definitions (public, no auth required)', async () => {
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
    mockQuery.mockResolvedValueOnce({ rows: [ACTIVE_SUBSCRIPTION_ROW] });

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
    const res = await request(app)
      .post('/api/v1/subscription/request')
      .set(authHeader())
      .send({ planTier: 'invalid' });

    expect(res.status).toBe(400);
  });

  it('should return 409 when user already has active subscription', async () => {
    // Check existing subscription
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'sub-1', status: 'active' }] });

    const res = await request(app)
      .post('/api/v1/subscription/request')
      .set(authHeader())
      .send({ planTier: 'starter' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUBSCRIPTION_ACTIVE');
  });

  it('should return 409 when user has pending subscription', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'sub-1', status: 'pending' }] });

    const res = await request(app)
      .post('/api/v1/subscription/request')
      .set(authHeader())
      .send({ planTier: 'starter' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUBSCRIPTION_PENDING');
  });

  it('should create subscription and payment on success', async () => {
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
          created_at: now,
          updated_at: now,
        }],
      }) // INSERT subscription
      .mockResolvedValueOnce({
        rows: [{
          id: 'pay-new',
          amount: '5',
          currency: 'USD',
          reference_code: 'WAS-TESTTEST',
          status: 'pending',
        }],
      }) // INSERT payment
      .mockResolvedValueOnce(undefined); // COMMIT

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

  it('should return 400 for invalid receipt URL', async () => {
    const res = await request(app)
      .post('/api/v1/subscription/receipt')
      .set(authHeader())
      .send({ paymentId: validPaymentId, receiptUrl: 'not-a-url' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for missing paymentId', async () => {
    const res = await request(app)
      .post('/api/v1/subscription/receipt')
      .set(authHeader())
      .send({ receiptUrl: 'https://example.com/receipt.png' });

    expect(res.status).toBe(400);
  });

  it('should return 404 when payment not found', async () => {
    // SELECT payment
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/v1/subscription/receipt')
      .set(authHeader())
      .send({ paymentId: validPaymentId, receiptUrl: 'https://example.com/receipt.png' });

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
      .send({ paymentId: validPaymentId, receiptUrl: 'https://example.com/receipt.png' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PAYMENT_FORBIDDEN');
  });

  it('should return 400 when payment is not pending', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: validPaymentId, user_id: TEST_USER.userId, status: 'approved' }],
    });

    const res = await request(app)
      .post('/api/v1/subscription/receipt')
      .set(authHeader())
      .send({ paymentId: validPaymentId, receiptUrl: 'https://example.com/receipt.png' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAYMENT_NOT_PENDING');
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
      .send({ paymentId: validPaymentId, receiptUrl: 'https://example.com/receipt.png' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
