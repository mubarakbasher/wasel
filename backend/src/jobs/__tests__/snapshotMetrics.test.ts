import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mocks so they exist before vi.mock factories evaluate.
// ---------------------------------------------------------------------------
const { cronTicks, mockGetStats } = vi.hoisted(() => ({
  cronTicks: [] as Array<() => void | Promise<void>>,
  mockGetStats: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: (
      _expr: string,
      fn: () => void | Promise<void>,
      _opts?: object,
    ) => {
      cronTicks.push(fn);
      return { start: vi.fn(), stop: vi.fn() };
    },
  },
}));

vi.mock('../../services/admin.service', () => ({
  getStats: mockGetStats,
}));

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;

import { startSnapshotMetricsJob } from '../snapshotMetrics';

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  cronTicks.length = 0;
  mockQuery.mockReset();
  mockGetStats.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('snapshotMetrics job', () => {
  it('calls getStats and upserts 8 columns into metrics_daily', async () => {
    startSnapshotMetricsJob();

    mockGetStats.mockResolvedValueOnce({
      totalUsers: 42,
      subscriptionsByStatus: { active: 10, cancelled: 2 },
      pendingPayments: 3,
      totalRevenue: 9999.5,
      routersByStatus: { online: 5, offline: 1, degraded: 0 },
      totalVouchers: 200,
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{ snapshot_date: '2026-06-30' }],
    });

    await cronTicks[0]();

    expect(mockGetStats).toHaveBeenCalledOnce();

    expect(mockQuery).toHaveBeenCalledOnce();
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO metrics_daily');
    expect(sql).toContain('ON CONFLICT (snapshot_date) DO UPDATE');
    expect(sql).toContain('RETURNING snapshot_date');

    const params = mockQuery.mock.calls[0][1] as unknown[];
    // Order: totalUsers, active, totalVouchers, totalRevenue, online, offline, degraded, pending
    expect(params).toEqual([42, 10, 200, 9999.5, 5, 1, 0, 3]);
  });

  it('defaults missing status buckets to 0', async () => {
    startSnapshotMetricsJob();

    mockGetStats.mockResolvedValueOnce({
      totalUsers: 0,
      subscriptionsByStatus: {},
      pendingPayments: 0,
      totalRevenue: 0,
      routersByStatus: {},
      totalVouchers: 0,
    });

    mockQuery.mockResolvedValueOnce({ rows: [{ snapshot_date: '2026-06-30' }] });

    await cronTicks[0]();

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe(0); // active_subscriptions
    expect(params[4]).toBe(0); // routers_online
    expect(params[5]).toBe(0); // routers_offline
    expect(params[6]).toBe(0); // routers_degraded
  });

  it('does not throw when getStats rejects', async () => {
    startSnapshotMetricsJob();
    mockGetStats.mockRejectedValueOnce(new Error('db down'));

    await expect(cronTicks[0]()).resolves.toBeUndefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
