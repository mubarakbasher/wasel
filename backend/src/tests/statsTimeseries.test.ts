import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { generateAccessToken } from '../services/token.service';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  userId: 'aaaaaaaa-0000-4000-8000-000000000099',
  email: 'admin-ts@example.com',
  name: 'Admin Timeseries',
  role: 'admin',
};

const REGULAR_USER = {
  userId: 'bbbbbbbb-0000-4000-8000-000000000001',
  email: 'user-ts@example.com',
  name: 'Regular User',
  role: 'user',
};

function adminAuth(): Record<string, string> {
  return { Authorization: `Bearer ${generateAccessToken(ADMIN_USER)}` };
}

function userAuth(): Record<string, string> {
  return { Authorization: `Bearer ${generateAccessToken(REGULAR_USER)}` };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockRow(date: string) {
  return {
    date,
    revenue: '150.75',
    newUsers: '3',
    vouchers: '7',
    activeSubscriptions: 12,
    routersOnline: 2,
  };
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQuery.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/stats/timeseries', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/stats/timeseries');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await request(app)
      .get('/api/v1/admin/stats/timeseries')
      .set(userAuth());
    expect(res.status).toBe(403);
  });

  it('returns 400 when days=2 (below minimum of 7)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/stats/timeseries?days=2')
      .set(adminAuth());
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when days=999 (above maximum of 365)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/stats/timeseries?days=999')
      .set(adminAuth());
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('defaults to 30 days when days param is omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeMockRow('2024-06-01')] });

    const res = await request(app)
      .get('/api/v1/admin/stats/timeseries')
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.days).toBe(30);
    expect(Array.isArray(res.body.data.series)).toBe(true);
  });

  it('returns correct envelope shape with typed fields for days=7', async () => {
    const rows = [makeMockRow('2024-06-24'), makeMockRow('2024-06-25')];
    mockQuery.mockResolvedValueOnce({ rows });

    const res = await request(app)
      .get('/api/v1/admin/stats/timeseries?days=7')
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.days).toBe(7);
    expect(res.body.data.series).toHaveLength(2);

    const point = res.body.data.series[0] as Record<string, unknown>;
    expect(typeof point.date).toBe('string');
    expect((point.date as string).length).toBe(10); // YYYY-MM-DD
    expect(typeof point.revenue).toBe('number');
    expect(typeof point.newUsers).toBe('number');
    expect(typeof point.vouchers).toBe('number');
    // activeSubscriptions and routersOnline may be number or null
    expect(
      point.activeSubscriptions === null || typeof point.activeSubscriptions === 'number',
    ).toBe(true);
    expect(
      point.routersOnline === null || typeof point.routersOnline === 'number',
    ).toBe(true);
  });

  it('coerces numeric string columns to JS numbers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeMockRow('2024-06-24')] });

    const res = await request(app)
      .get('/api/v1/admin/stats/timeseries?days=7')
      .set(adminAuth());

    expect(res.status).toBe(200);
    const point = res.body.data.series[0] as Record<string, unknown>;
    expect(point.revenue).toBe(150.75);
    expect(point.newUsers).toBe(3);
    expect(point.vouchers).toBe(7);
    expect(point.activeSubscriptions).toBe(12);
    expect(point.routersOnline).toBe(2);
  });

  it('passes null through for missing snapshot metrics', async () => {
    const row = {
      date: '2024-06-24',
      revenue: '0',
      newUsers: '0',
      vouchers: '0',
      activeSubscriptions: null,
      routersOnline: null,
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const res = await request(app)
      .get('/api/v1/admin/stats/timeseries?days=7')
      .set(adminAuth());

    expect(res.status).toBe(200);
    const point = res.body.data.series[0] as Record<string, unknown>;
    expect(point.activeSubscriptions).toBeNull();
    expect(point.routersOnline).toBeNull();
  });

  it('service SQL uses generate_series and ::date bucketing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeMockRow('2024-06-24')] });

    await request(app)
      .get('/api/v1/admin/stats/timeseries?days=7')
      .set(adminAuth());

    // Exactly one pool.query call for the timeseries (auth is JWT-only, no DB)
    expect(mockQuery).toHaveBeenCalledOnce();
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('generate_series');
    expect(sql).toContain('::date');
    // Revenue bucketed by COALESCE(reviewed_at, created_at)::date
    expect(sql).toContain('reviewed_at');
    expect(sql).toContain('voucher_meta');
    // Parameterized with days
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toEqual([7]);
  });
});
