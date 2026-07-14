/**
 * Tests for Arabic plan-name localisation (migration 034_plans_name_ar).
 *
 * Covers:
 *   - GET /subscription/plans     → each plan item has `nameAr`
 *   - GET /subscription           → SubscriptionInfo has `planNameAr`
 *   - GET /subscription/payments  → each payment has `planNameAr`
 *   - GET /dashboard              → subscription summary has `planNameAr`
 *   - GET /admin/plans            → each plan row has `name_ar`
 *   - POST /admin/plans           → persists `name_ar`
 *   - PUT /admin/plans/:id        → updates `name_ar`
 *
 * All tests are null-safe: they run both with and without name_ar set.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { TEST_USER, authHeader, ACTIVE_SUBSCRIPTION_ROW } from './helpers';
import { generateAccessToken } from '../services/token.service';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof import('vitest').vi.fn
>;
const mockClientQuery = (globalThis as Record<string, unknown>)
  .__mockClientQuery as ReturnType<typeof import('vitest').vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_PLAN_ROW = {
  id: 'plan-starter',
  tier: 'starter',
  name: 'Starter',
  name_ar: 'المبتدئ',
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

const BASE_PLAN_ROW_NO_AR = {
  ...BASE_PLAN_ROW,
  name_ar: null,
};

// Admin identity
const ADMIN_USER = {
  userId: 'aaaaaaaa-0000-4000-8000-000000000099',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
};

function adminAuth(): Record<string, string> {
  const token = generateAccessToken(ADMIN_USER);
  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// GET /subscription/plans
// ---------------------------------------------------------------------------

describe('GET /api/v1/subscription/plans — nameAr field', () => {
  it('returns nameAr when name_ar is set in DB', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [BASE_PLAN_ROW] });

    const res = await request(app).get('/api/v1/subscription/plans');

    expect(res.status).toBe(200);
    const plan = res.body.data[0];
    expect(plan.nameAr).toBe('المبتدئ');
  });

  it('returns null nameAr when name_ar is null in DB', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [BASE_PLAN_ROW_NO_AR] });

    const res = await request(app).get('/api/v1/subscription/plans');

    expect(res.status).toBe(200);
    const plan = res.body.data[0];
    expect(plan.nameAr).toBeNull();
  });

  it('does not crash when multiple plans have mixed name_ar values', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        BASE_PLAN_ROW,
        { ...BASE_PLAN_ROW_NO_AR, id: 'plan-pro', tier: 'professional', name: 'Professional' },
      ],
    });

    const res = await request(app).get('/api/v1/subscription/plans');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].nameAr).toBe('المبتدئ');
    expect(res.body.data[1].nameAr).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /subscription (current subscription)
// ---------------------------------------------------------------------------

describe('GET /api/v1/subscription — planNameAr field', () => {
  it('returns planNameAr when plan has an Arabic name', async () => {
    // getCurrentSubscription SELECT
    mockQuery.mockResolvedValueOnce({ rows: [ACTIVE_SUBSCRIPTION_ROW] });
    // toSubscriptionInfo → getPlanByTier SELECT
    mockQuery.mockResolvedValueOnce({ rows: [BASE_PLAN_ROW] });

    const res = await request(app).get('/api/v1/subscription').set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.planNameAr).toBe('المبتدئ');
  });

  it('returns null planNameAr when plan has no Arabic name', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ACTIVE_SUBSCRIPTION_ROW] });
    mockQuery.mockResolvedValueOnce({ rows: [BASE_PLAN_ROW_NO_AR] });

    const res = await request(app).get('/api/v1/subscription').set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.planNameAr).toBeNull();
  });

  it('returns null planNameAr when plan row is not found in plans table', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ACTIVE_SUBSCRIPTION_ROW] });
    // getPlanByTier returns nothing — plan was deleted
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v1/subscription').set(authHeader());

    expect(res.status).toBe(200);
    // Falls back gracefully: planName = plan_tier, planNameAr = null
    expect(res.body.data.planNameAr).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /subscription/payments
// ---------------------------------------------------------------------------

describe('GET /api/v1/subscription/payments — planNameAr field', () => {
  const paymentRow = {
    id: 'pay-001',
    plan_tier: 'starter',
    amount: '5',
    currency: 'SDG',
    reference_code: 'WAS-ABC12345',
    receipt_url: null,
    status: 'pending',
    rejection_reason: null,
    reviewed_at: null,
    created_at: new Date(),
    plan_name: 'Starter',
    plan_name_ar: 'المبتدئ',
  };

  it('returns planNameAr when plan has an Arabic name', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [paymentRow] });

    const res = await request(app)
      .get('/api/v1/subscription/payments')
      .set(authHeader());

    expect(res.status).toBe(200);
    const payment = res.body.data[0];
    expect(payment.planNameAr).toBe('المبتدئ');
  });

  it('returns null planNameAr when plan_name_ar is null', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...paymentRow, plan_name_ar: null }],
    });

    const res = await request(app)
      .get('/api/v1/subscription/payments')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data[0].planNameAr).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /dashboard — subscription summary planNameAr
// ---------------------------------------------------------------------------

describe('GET /api/v1/dashboard — subscription.planNameAr field', () => {
  /**
   * Dashboard fires 7 pool.query calls in parallel via Promise.all, then
   * getActiveSubscription resolves and triggers a second query (getPlanByTier)
   * sequentially inside toSubscriptionInfo. Queue order:
   *  1. routers
   *  2. getActiveSubscription → SELECT subscriptions
   *  3. vouchersUsedToday
   *  4. dailyRevenue
   *  5. totalVouchers
   *  6. dataUsage24h
   *  7. activeSessionsByRouter
   *  8. getPlanByTier (fires after subscription row resolves)
   */
  function queueDashboardMocks(planRow: typeof BASE_PLAN_ROW | typeof BASE_PLAN_ROW_NO_AR) {
    mockQuery.mockResolvedValueOnce({ rows: [] });                                       // 1. routers
    mockQuery.mockResolvedValueOnce({ rows: [ACTIVE_SUBSCRIPTION_ROW] });               // 2. subscriptions
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });                        // 3. vouchersUsedToday
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });                        // 4. dailyRevenue
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });                        // 5. totalVouchers
    mockQuery.mockResolvedValueOnce({ rows: [{ total_input: '0', total_output: '0' }] }); // 6. dataUsage24h
    mockQuery.mockResolvedValueOnce({ rows: [] });                                       // 7. activeSessionsByRouter
    mockQuery.mockResolvedValueOnce({ rows: [planRow] });                               // 8. getPlanByTier
  }

  it('returns planNameAr in dashboard subscription summary', async () => {
    queueDashboardMocks(BASE_PLAN_ROW);

    const res = await request(app).get('/api/v1/dashboard').set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.subscription.planNameAr).toBe('المبتدئ');
  });

  it('returns null planNameAr in dashboard when plan has no Arabic name', async () => {
    queueDashboardMocks(BASE_PLAN_ROW_NO_AR);

    const res = await request(app).get('/api/v1/dashboard').set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.subscription.planNameAr).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /admin/plans
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/plans — name_ar field', () => {
  it('includes name_ar in each plan row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [BASE_PLAN_ROW] });

    const res = await request(app).get('/api/v1/admin/plans').set(adminAuth());

    expect(res.status).toBe(200);
    const plan = res.body.data[0];
    expect(plan.name_ar).toBe('المبتدئ');
  });

  it('returns null name_ar when not set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [BASE_PLAN_ROW_NO_AR] });

    const res = await request(app).get('/api/v1/admin/plans').set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.data[0].name_ar).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /admin/plans — create with name_ar
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/plans — name_ar persistence', () => {
  const newPlanBody = {
    tier: 'custom',
    name: 'Custom',
    name_ar: 'مخصص',
    price: 20,
    max_routers: 2,
    monthly_vouchers: 1000,
  };

  it('persists name_ar when provided', async () => {
    // Audit-log insert (admin middleware writes audit log after the action)
    // createPlan SELECT* RETURNING
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...BASE_PLAN_ROW, tier: 'custom', name: 'Custom', name_ar: 'مخصص' }],
    });
    // audit log INSERT (fire-and-forget in admin controller)
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/api/v1/admin/plans')
      .set(adminAuth())
      .send(newPlanBody);

    expect(res.status).toBe(201);
    // Verify the SQL that was sent included name_ar
    const calls = mockQuery.mock.calls as unknown[][];
    const insertCall = calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO plans'),
    ) as [string, unknown[]] | undefined;
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain('مخصص');
  });

  it('accepts null name_ar (no Arabic name)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...BASE_PLAN_ROW_NO_AR, tier: 'custom', name: 'Custom' }],
    });
    mockQuery.mockResolvedValue({ rows: [] });

    const { name_ar: _drop, ...bodyWithoutAr } = newPlanBody;
    const res = await request(app)
      .post('/api/v1/admin/plans')
      .set(adminAuth())
      .send(bodyWithoutAr);

    expect(res.status).toBe(201);
  });

  it('rejects name_ar longer than 100 chars with 400', async () => {
    const res = await request(app)
      .post('/api/v1/admin/plans')
      .set(adminAuth())
      .send({ ...newPlanBody, name_ar: 'أ'.repeat(101) });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PUT /admin/plans/:id — update name_ar
// ---------------------------------------------------------------------------

describe('PUT /api/v1/admin/plans/:id — name_ar update', () => {
  const PLAN_ID = '00000000-0000-4000-8000-000000000001';

  it('updates name_ar when provided', async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...BASE_PLAN_ROW, name_ar: 'الاحترافي' }],
    });
    mockQuery.mockResolvedValue({ rows: [] }); // audit log

    const res = await request(app)
      .put(`/api/v1/admin/plans/${PLAN_ID}`)
      .set(adminAuth())
      .send({ name_ar: 'الاحترافي' });

    expect(res.status).toBe(200);
    // Verify the UPDATE SQL contained name_ar
    const calls = mockQuery.mock.calls as unknown[][];
    const updateCall = calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE plans SET'),
    ) as [string, unknown[]] | undefined;
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toContain('name_ar');
  });

  it('can clear name_ar by sending null', async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...BASE_PLAN_ROW_NO_AR }],
    });
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .put(`/api/v1/admin/plans/${PLAN_ID}`)
      .set(adminAuth())
      .send({ name_ar: null });

    expect(res.status).toBe(200);
  });

  it('rejects name_ar longer than 100 chars with 400', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/plans/${PLAN_ID}`)
      .set(adminAuth())
      .send({ name_ar: 'ب'.repeat(101) });

    expect(res.status).toBe(400);
  });
});
