import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { TEST_USER, authHeader, ACTIVE_SUBSCRIPTION_ROW } from './helpers';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

const now = new Date();

beforeEach(() => {
  mockQuery.mockReset();
});

// ─── GET /api/v1/dashboard ───────────────────────────────────────────────────

describe('GET /api/v1/dashboard', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app).get('/api/v1/dashboard');
    expect(res.status).toBe(401);
  });

  it('should return full dashboard data', async () => {
    // Dashboard runs 6 queries in Promise.all
    // The order of mock consumption depends on Promise.all resolution order
    // Since all are pool.query (same mock), they resolve in array order:

    // 1. Routers SELECT
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', name: 'Office Router', status: 'online', last_seen: now }],
    });
    // 2. getActiveSubscription → SELECT subscriptions
    mockQuery.mockResolvedValueOnce({ rows: [ACTIVE_SUBSCRIPTION_ROW] });
    // 3. Vouchers created today
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] });
    // 4. Total vouchers
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '42' }] });
    // 5. Data usage 24h
    mockQuery.mockResolvedValueOnce({
      rows: [{ total_input: '104857600', total_output: '524288000' }],
    });
    // 6. Active sessions by router
    mockQuery.mockResolvedValueOnce({
      rows: [{ router_id: 'r1', router_name: 'Office Router', active_sessions: 3 }],
    });

    const res = await request(app)
      .get('/api/v1/dashboard')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.routers).toHaveLength(1);
    expect(data.routers[0].name).toBe('Office Router');
    expect(data.subscription).not.toBeNull();
    expect(data.subscription.planTier).toBe('starter');
    expect(data.vouchersCreatedToday).toBe(5);
    expect(data.totalVouchers).toBe(42);
    expect(data.dataUsage24h.totalInput).toBe(104857600);
    expect(data.dataUsage24h.totalOutput).toBe(524288000);
    expect(data.activeSessionsByRouter).toHaveLength(1);
    expect(data.activeSessionsByRouter[0].activeSessions).toBe(3);
  });

  it('should return dashboard with no subscription', async () => {
    // 1. Routers
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 2. getActiveSubscription — no subscription
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 3. Vouchers today
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    // 4. Total vouchers
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    // 5. Data usage
    mockQuery.mockResolvedValueOnce({ rows: [{ total_input: '0', total_output: '0' }] });
    // 6. Active sessions
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/v1/dashboard')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.routers).toHaveLength(0);
    expect(res.body.data.subscription).toBeNull();
    expect(res.body.data.vouchersCreatedToday).toBe(0);
    expect(res.body.data.totalVouchers).toBe(0);
  });
});
