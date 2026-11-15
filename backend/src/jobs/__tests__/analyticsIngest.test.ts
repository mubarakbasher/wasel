import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mocks
// ---------------------------------------------------------------------------
const { cronTicks, mockAnalyticsJobsEnabled } = vi.hoisted(() => ({
  cronTicks: [] as Array<() => void | Promise<void>>,
  mockAnalyticsJobsEnabled: vi.fn().mockReturnValue(true),
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

vi.mock('../../services/analyticsDb', () => ({
  withGuardedClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => {
    return fn(mockClient);
  }),
  getAnalyticsState: vi.fn(),
  setAnalyticsState: vi.fn().mockResolvedValue(undefined),
  analyticsJobsEnabled: mockAnalyticsJobsEnabled,
}));

// Mock client used by withGuardedClient
const mockClientQuery = vi.fn();
const mockClient = { query: mockClientQuery, release: vi.fn() };

import {
  startAnalyticsIngestJob,
  runAnalyticsIngest,
  ingestBatch,
  _resetIngestState,
} from '../analyticsIngest';
import { withGuardedClient } from '../../services/analyticsDb';

beforeEach(() => {
  vi.clearAllMocks();
  cronTicks.length = 0;
  mockClientQuery.mockReset();
  mockAnalyticsJobsEnabled.mockReturnValue(true);
  _resetIngestState();
  vi.mocked(withGuardedClient).mockImplementation(
    async (fn) => fn(mockClient as never),
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analyticsIngest', () => {
  it('issues no query when ANALYTICS_JOBS_ENABLED is false', async () => {
    mockAnalyticsJobsEnabled.mockReturnValue(false);
    await runAnalyticsIngest(new Date('2026-11-15T10:00:00Z'));
    expect(withGuardedClient).not.toHaveBeenCalled();
  });

  it('is skipped between 01:10 and 04:00 UTC', async () => {
    // 02:30 UTC is in the skip window
    await runAnalyticsIngest(new Date('2026-11-15T02:30:00Z'));
    expect(withGuardedClient).not.toHaveBeenCalled();
  });

  it('is NOT skipped at 01:09 UTC', async () => {
    // 01:09 is just before the skip window; cursor query should fire
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ value: '1000' }] })  // cursor SELECT
      .mockResolvedValueOnce({ rows: [] })                    // radacct SELECT (0 rows)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });      // insert (not reached)
    await runAnalyticsIngest(new Date('2026-11-15T01:09:00Z'));
    expect(withGuardedClient).toHaveBeenCalled();
  });

  it('reads after the cursor with a 100-id overlap and LIMIT 2000', async () => {
    // Simulate: cursor = 5000, radacct returns 1 row
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ value: '5000' }] })  // cursor
      .mockResolvedValueOnce({                                 // radacct SELECT
        rows: [{ radacctid: '5100', username: 'abc', acctstarttime: new Date() }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });      // INSERT

    await runAnalyticsIngest(new Date('2026-11-15T10:00:00Z'));

    const calls = mockClientQuery.mock.calls;
    const radacctSql = calls[1][0] as string;
    expect(radacctSql).toContain('radacctid > $1 - 100');
    expect(radacctSql).toContain('LIMIT 2000');
    expect(calls[1][1]).toEqual([5000]);
  });

  it('inserts first uses with unnest and ON CONFLICT DO NOTHING', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ value: '0' }] })
      .mockResolvedValueOnce({
        rows: [{ radacctid: '10', username: 'u1', acctstarttime: new Date() }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await runAnalyticsIngest(new Date('2026-11-15T10:00:00Z'));

    const insertCall = mockClientQuery.mock.calls[2];
    const sql = insertCall[0] as string;
    expect(sql).toContain('analytics_card_first_use');
    expect(sql).toContain('unnest');
    expect(sql).toContain('ON CONFLICT (radius_username) DO NOTHING');
  });

  it('updates the cursor before COMMIT in the same transaction', async () => {
    // The cursor update (setAnalyticsState) is called inside withGuardedClient's fn
    const { setAnalyticsState } = await import('../../services/analyticsDb');

    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ value: '500' }] })
      .mockResolvedValueOnce({
        rows: [{ radacctid: '600', username: 'x', acctstarttime: new Date() }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await runAnalyticsIngest(new Date('2026-11-15T10:00:00Z'));

    expect(setAnalyticsState).toHaveBeenCalledWith(
      'radacct_cursor',
      '600',
      mockClient,
    );
  });

  it('leaves the cursor unchanged when the insert fails', async () => {
    // The withGuardedClient wrapper will rollback + release(true) on error.
    vi.mocked(withGuardedClient).mockRejectedValueOnce(new Error('insert failed'));

    const { setAnalyticsState } = await import('../../services/analyticsDb');

    // Should not throw
    await expect(runAnalyticsIngest(new Date('2026-11-15T10:00:00Z'))).resolves.toBeUndefined();

    // Cursor update should not have been called
    expect(setAnalyticsState).not.toHaveBeenCalled();
  });

  it('stops when the cursor row is locked by another run', async () => {
    // FOR UPDATE SKIP LOCKED returns 0 rows when locked
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    await runAnalyticsIngest(new Date('2026-11-15T10:00:00Z'));

    // Only the cursor query was issued; no radacct query
    expect(mockClientQuery).toHaveBeenCalledOnce();
    const sql = mockClientQuery.mock.calls[0][0] as string;
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('does nothing when the cursor is NULL', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [{ value: null }] });

    await runAnalyticsIngest(new Date('2026-11-15T10:00:00Z'));

    // Only the cursor query; no radacct query
    expect(mockClientQuery).toHaveBeenCalledOnce();
  });

  it('registers a cron job', () => {
    startAnalyticsIngestJob();
    expect(cronTicks).toHaveLength(1);
  });
});

describe('ingestBatch', () => {
  it('passes upperBound as $2 when provided', async () => {
    mockClientQuery
      .mockResolvedValueOnce({
        rows: [{ radacctid: '50', username: 'u', acctstarttime: new Date() }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await ingestBatch(mockClient as never, 1, 100);

    const selectCall = mockClientQuery.mock.calls[0];
    expect(selectCall[0]).toContain('radacctid <= $2');
    expect(selectCall[1]).toEqual([1, 100]);
  });
});
