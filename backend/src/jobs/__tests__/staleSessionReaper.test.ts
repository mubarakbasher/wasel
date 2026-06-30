import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so the mock exists before vi.mock factories evaluate.
const { cronTicks } = vi.hoisted(() => ({
  cronTicks: [] as Array<() => void | Promise<void>>,
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: (_expr: string, fn: () => void | Promise<void>) => {
      cronTicks.push(fn);
      return { start: vi.fn(), stop: vi.fn() };
    },
  },
}));

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

import { startStaleSessionReaperJob } from '../staleSessionReaper';

beforeEach(() => {
  cronTicks.length = 0;
  mockQuery.mockReset();
});

describe('staleSessionReaper job', () => {
  it('issues a single UPDATE that closes only open rows older than 15 minutes', async () => {
    startStaleSessionReaperJob();
    mockQuery.mockResolvedValueOnce({ rowCount: 3 });

    await cronTicks[0]();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockQuery.mock.calls[0] as [string];

    // Must target only open sessions
    expect(sql).toMatch(/acctstoptime IS NULL/i);
    // Must use a 15-minute threshold
    expect(sql).toMatch(/15 minutes/i);
    // Must close to last-known-alive time, not NOW()
    expect(sql).toMatch(/COALESCE\(acctupdatetime,\s*acctstarttime\)/i);
    // Must set acctterminatecause
    expect(sql).toMatch(/acctterminatecause\s*=\s*'Reaped-Stale'/i);
    // Must NOT touch acctsessiontime (would over-count time vouchers)
    expect(sql).not.toMatch(/acctsessiontime/i);
  });

  it('is a no-op (no log) when rowCount is 0', async () => {
    startStaleSessionReaperJob();
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    await expect(cronTicks[0]()).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the query fails', async () => {
    startStaleSessionReaperJob();
    mockQuery.mockRejectedValueOnce(new Error('db down'));

    await expect(cronTicks[0]()).resolves.toBeUndefined();
  });
});
