import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mocks
// ---------------------------------------------------------------------------
const { cronTicks, mockReconcile, mockExpiry } = vi.hoisted(() => ({
  cronTicks: [] as Array<() => void | Promise<void>>,
  mockReconcile: vi.fn().mockResolvedValue(0),
  mockExpiry: vi.fn().mockResolvedValue(0),
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

vi.mock('../../services/analyticsRecording.service', () => ({
  reconcileIncomeLedger: mockReconcile,
}));

vi.mock('../../services/subscription.service', () => ({
  updateExpiredSubscriptions: mockExpiry,
}));

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

import { runMoneySync, startAnalyticsMoneySyncJob } from '../analyticsMoneySync';

beforeEach(() => {
  cronTicks.length = 0;
  mockQuery.mockReset();
  mockReconcile.mockReset().mockResolvedValue(0);
  mockExpiry.mockReset().mockResolvedValue(0);
});

describe('analyticsMoneySync', () => {
  it('runs expiry, reconcile, period_end refresh and activity prune in order', async () => {
    // Three pool queries: period_end refresh, activity prune, (no integrity check since not hour 4)
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // period_end UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // activity prune

    await runMoneySync(new Date('2026-11-15T10:00:00Z'));

    expect(mockExpiry).toHaveBeenCalledOnce();
    expect(mockReconcile).toHaveBeenCalledOnce();

    const queries = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(queries[0]).toContain('UPDATE income_ledger');
    expect(queries[1]).toContain('DELETE FROM operator_activity');
  });

  it('one failing step does not stop the others', async () => {
    mockExpiry.mockRejectedValueOnce(new Error('expiry failed'));
    mockReconcile.mockRejectedValueOnce(new Error('reconcile failed'));
    mockQuery
      .mockRejectedValueOnce(new Error('period_end failed'))
      .mockRejectedValueOnce(new Error('prune failed'));

    // Should not throw
    await expect(runMoneySync(new Date('2026-11-15T10:00:00Z'))).resolves.toBeUndefined();
  });

  it('compares payments with the ledger only in UTC hour 4', async () => {
    // At UTC hour 4, two extra queries are issued
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // period_end
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // prune
      .mockResolvedValueOnce({ rows: [{ cnt: '5', total: '1000' }] }) // payments
      .mockResolvedValueOnce({ rows: [{ cnt: '5', total: '1000' }] }); // ledger

    await runMoneySync(new Date('2026-11-15T04:30:00Z'));

    expect(mockQuery).toHaveBeenCalledTimes(4);
    const queries = mockQuery.mock.calls.map((c) => c[0] as string);
    expect(queries[2]).toContain("status = 'approved'");
    expect(queries[3]).toContain('income_ledger');
  });

  it('does NOT run the integrity check outside UTC hour 4', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await runMoneySync(new Date('2026-11-15T10:00:00Z'));

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('registers a cron job', () => {
    startAnalyticsMoneySyncJob();
    expect(cronTicks).toHaveLength(1);
  });
});
