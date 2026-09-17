import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mocks before vi.mock() factory functions evaluate.
// ---------------------------------------------------------------------------
const { cronCallbacks, mockLoggerError, mockLoggerInfo } = vi.hoisted(() => ({
  cronCallbacks: {} as Record<string, () => void | Promise<void>>,
  mockLoggerError: vi.fn(),
  mockLoggerInfo: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: (expr: string, fn: () => void | Promise<void>) => {
      cronCallbacks[expr] = fn;
      return { start: vi.fn(), stop: vi.fn() };
    },
  },
}));

vi.mock('../../config/logger', () => ({
  default: {
    info: mockLoggerInfo,
    warn: vi.fn(),
    error: mockLoggerError,
  },
}));

const mockPoolQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;
const mockClientQuery = (globalThis as Record<string, unknown>).__mockClientQuery as ReturnType<
  typeof vi.fn
>;

import {
  startUsageLimitEnforcementJob,
  _resetJobState,
} from '../usageLimitEnforcement';
import { pool } from '../../config/database';

// A failed transaction must destroy its pooled connection (release(true)):
// a timed-out query can leave the client idle-in-transaction otherwise.
function spyNextConnectRelease(): ReturnType<typeof vi.fn> {
  const release = vi.fn();
  (vi.spyOn(pool, 'connect') as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    query: mockClientQuery,
    release,
  });
  return release;
}

// ---------------------------------------------------------------------------
// Schedule expression constants (must match the job file)
// ---------------------------------------------------------------------------
const FAST_CRON = '*/30 * * * * *';
const DAILY_CRON = '0 40 2 * * *';

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  _resetJobState();
  mockPoolQuery.mockReset();
  mockClientQuery.mockReset();
  mockLoggerError.mockReset();
  mockLoggerInfo.mockReset();
});

// ---------------------------------------------------------------------------
// Fast pass
// ---------------------------------------------------------------------------
describe('usageLimitEnforcement fast pass', () => {
  it('passes the candidate username array as $1 to both filtered SQL queries', async () => {
    startUsageLimitEnforcementJob();

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ max_id: '200' }] })  // watermark init
      .mockResolvedValueOnce({                                 // candidate
        rows: [{ username: 'u1', open: true, max_id: '210' }],
      })
      .mockResolvedValueOnce({ rows: [] })  // fast time SQL (no over-limit)
      .mockResolvedValueOnce({ rows: [] }); // fast data SQL (no over-limit)

    await cronCallbacks[FAST_CRON]();

    // 3rd call = time query, 4th = data query
    const timeCallArgs = mockPoolQuery.mock.calls[2] as [string, [string[]]];
    const dataCallArgs = mockPoolQuery.mock.calls[3] as [string, [string[]]];

    expect(timeCallArgs[1][0]).toEqual(['u1']);
    expect(dataCallArgs[1][0]).toEqual(['u1']);

    expect(timeCallArgs[0]).toMatch(/ANY\(\$1::text\[\]\)/i);
    expect(dataCallArgs[0]).toMatch(/ANY\(\$1::text\[\]\)/i);
  });

  it('skips the enforcement queries when there are no candidates', async () => {
    startUsageLimitEnforcementJob();

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
      .mockResolvedValueOnce({ rows: [] }); // no candidates

    await cronCallbacks[FAST_CRON]();

    // Only init + candidate (2 calls); no time/data SQL
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('guard blocks a concurrent tick', async () => {
    startUsageLimitEnforcementJob();

    let releaseFirst!: () => void;
    const blocked = new Promise<void>((res) => {
      releaseFirst = res;
    });
    mockPoolQuery.mockReturnValueOnce(
      blocked.then(() => ({ rows: [{ max_id: '0' }] })),
    );

    const tick1 = cronCallbacks[FAST_CRON]();
    const tick2 = cronCallbacks[FAST_CRON]();
    await tick2; // must return immediately (guard)

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);

    releaseFirst();
    mockPoolQuery.mockResolvedValue({ rows: [] });
    await tick1;
  });

  it('produces BEGIN / DELETE / INSERT / UPDATE / COMMIT for a time-over-limit row', async () => {
    startUsageLimitEnforcementJob();

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
      .mockResolvedValueOnce({
        rows: [{ username: 'u-time', open: true, max_id: '1' }],
      })
      .mockResolvedValueOnce({                                    // time fast SQL: over limit
        rows: [{
          radius_username: 'u-time',
          limit_value: '3600',
          total_used: '4000',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });                       // data fast SQL: nothing

    // enforceLimit uses mockClientQuery
    mockClientQuery
      .mockResolvedValueOnce({})   // BEGIN
      .mockResolvedValueOnce({})   // DELETE
      .mockResolvedValueOnce({})   // INSERT Auth-Type Reject
      .mockResolvedValueOnce({})   // UPDATE voucher_meta status=expired
      .mockResolvedValueOnce({});  // COMMIT

    await cronCallbacks[FAST_CRON]();

    const clientCalls = mockClientQuery.mock.calls.map((c) => c[0] as string);
    expect(clientCalls[0]).toBe('BEGIN');
    expect(clientCalls[1]).toMatch(/DELETE FROM radcheck/i);
    expect(clientCalls[2]).toMatch(/INSERT INTO radcheck/i);
    expect(clientCalls[3]).toMatch(/UPDATE voucher_meta/i);
    expect(clientCalls[4]).toBe('COMMIT');
  });

  it('produces BEGIN / DELETE / INSERT / UPDATE / COMMIT for a data-over-limit row', async () => {
    startUsageLimitEnforcementJob();

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
      .mockResolvedValueOnce({
        rows: [{ username: 'u-data', open: true, max_id: '2' }],
      })
      .mockResolvedValueOnce({ rows: [] })                        // time: no rows
      .mockResolvedValueOnce({                                    // data: over limit
        rows: [{
          radius_username: 'u-data',
          limit_value: '1073741824',
          total_used: '2000000000',
        }],
      });

    mockClientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await cronCallbacks[FAST_CRON]();

    const clientCalls = mockClientQuery.mock.calls.map((c) => c[0] as string);
    expect(clientCalls[0]).toBe('BEGIN');
    expect(clientCalls[4]).toBe('COMMIT');
  });

  it('ROLLBACK on enforceLimit error', async () => {
    startUsageLimitEnforcementJob();

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
      .mockResolvedValueOnce({
        rows: [{ username: 'u-err', open: true, max_id: '3' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          radius_username: 'u-err',
          limit_value: '100',
          total_used: '200',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    mockClientQuery
      .mockResolvedValueOnce({})                            // BEGIN
      .mockRejectedValueOnce(new Error('constraint'))       // DELETE fails
      .mockResolvedValueOnce({});                           // ROLLBACK
    const release = spyNextConnectRelease();

    await expect(cronCallbacks[FAST_CRON]()).resolves.toBeUndefined();

    const clientCalls = mockClientQuery.mock.calls.map((c) => c[0] as string);
    expect(clientCalls[0]).toBe('BEGIN');
    expect(clientCalls[2]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(true);
  });

  it('does not throw when the candidate query fails', async () => {
    startUsageLimitEnforcementJob();

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })  // init
      .mockRejectedValueOnce(new Error('db down'));          // candidate query

    await expect(cronCallbacks[FAST_CRON]()).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('fast pass failed'),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------
describe('usageLimitEnforcement reconciliation', () => {
  it('does not run before the startup delay (+5 min)', async () => {
    vi.useFakeTimers();
    try {
      startUsageLimitEnforcementJob();

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await cronCallbacks[FAST_CRON]();

      expect(mockClientQuery).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs on a dedicated client with SET LOCAL statement_timeout after the delay', async () => {
    vi.useFakeTimers();
    try {
      startUsageLimitEnforcementJob();

      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

      // Fast pass: no candidates
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      // Reconciliation: BEGIN, SET LOCAL, time query, data query, COMMIT
      mockClientQuery
        .mockResolvedValueOnce({})                    // BEGIN
        .mockResolvedValueOnce({})                    // SET LOCAL
        .mockResolvedValueOnce({ rows: [] })          // time query
        .mockResolvedValueOnce({ rows: [] })          // data query
        .mockResolvedValueOnce({});                   // COMMIT

      await cronCallbacks[FAST_CRON]();

      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');

      const clientCalls = mockClientQuery.mock.calls as Array<[unknown]>;
      const hasStatementTimeout = clientCalls.some((args) => {
        const q = args[0];
        if (typeof q === 'string') return q.includes('statement_timeout');
        if (q !== null && typeof q === 'object' && 'text' in q) {
          return String((q as { text: unknown }).text).includes('statement_timeout');
        }
        return false;
      });
      expect(hasStatementTimeout).toBe(true);
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs both time and data queries during reconciliation', async () => {
    vi.useFakeTimers();
    try {
      startUsageLimitEnforcementJob();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      mockClientQuery
        .mockResolvedValueOnce({})               // BEGIN
        .mockResolvedValueOnce({})               // SET LOCAL
        .mockResolvedValueOnce({ rows: [] })     // time recon
        .mockResolvedValueOnce({ rows: [] })     // data recon
        .mockResolvedValueOnce({});              // COMMIT

      await cronCallbacks[FAST_CRON]();

      // 5 client calls: BEGIN + SET LOCAL + time + data + COMMIT
      expect(mockClientQuery).toHaveBeenCalledTimes(5);

      // The time and data queries must be the UNFILTERED SQL: no candidate
      // filter (the fast SQL uses `ANY($1::text[])`), no bind parameters, and
      // the per-query 310 s client timeout.
      const reconCalls = [mockClientQuery.mock.calls[2], mockClientQuery.mock.calls[3]] as Array<
        [unknown, unknown?]
      >;
      const expectedLimitTypes = ["vm.limit_type = 'time'", "vm.limit_type = 'data'"];
      reconCalls.forEach((call, i) => {
        const q = call[0] as { text: string; query_timeout?: number; values?: unknown };
        expect(typeof q).toBe('object');
        expect(q.text).toContain(expectedLimitTypes[i]);
        expect(q.text).not.toContain('ANY(');
        expect(q.text).not.toContain('$1');
        expect(q.values).toBeUndefined();
        expect(call[1]).toBeUndefined();
        expect(q.query_timeout).toBe(310_000);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies over-limit rows found during reconciliation', async () => {
    vi.useFakeTimers();
    try {
      startUsageLimitEnforcementJob();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      // Reconciliation returns one time-limited over-limit row
      mockClientQuery
        .mockResolvedValueOnce({})   // BEGIN
        .mockResolvedValueOnce({})   // SET LOCAL
        .mockResolvedValueOnce({     // time recon
          rows: [{
            radius_username: 'recon-user',
            limit_value: '7200',
            total_used: '8000',
          }],
        })
        .mockResolvedValueOnce({ rows: [] })  // data recon
        .mockResolvedValueOnce({})            // COMMIT
        // enforceLimit for recon-user:
        .mockResolvedValueOnce({})   // BEGIN
        .mockResolvedValueOnce({})   // DELETE
        .mockResolvedValueOnce({})   // INSERT
        .mockResolvedValueOnce({})   // UPDATE
        .mockResolvedValueOnce({});  // COMMIT

      await cronCallbacks[FAST_CRON]();

      // 5 recon + 5 enforceLimit = 10 client calls
      expect(mockClientQuery).toHaveBeenCalledTimes(10);

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.stringContaining('reconciliation completed'),
        expect.objectContaining({ applied: 1 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('reschedules reconciliation +15 min on failure', async () => {
    vi.useFakeTimers();
    try {
      startUsageLimitEnforcementJob();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

      // First tick: init (1) + candidate (1) = 2 pool queries, then reconciliation fails
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })  // watermark init
        .mockResolvedValueOnce({ rows: [] });                  // candidate (no candidates)

      mockClientQuery
        .mockResolvedValueOnce({})                        // BEGIN
        .mockRejectedValueOnce(new Error('query failed')) // SET LOCAL fails
        .mockResolvedValueOnce({});                       // ROLLBACK
      const release = spyNextConnectRelease();

      await cronCallbacks[FAST_CRON]();
      expect(release).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledWith(true);

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.stringContaining('rescheduling in 15 min'),
        expect.anything(),
      );

      // After first tick, watermark is initialised — subsequent ticks call
      // pool.query only ONCE (candidate query; no re-init).
      // 1 min later: reconciliation not yet due (due in 15 min from failure)
      mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // candidate only
      vi.advanceTimersByTime(60 * 1000);
      await cronCallbacks[FAST_CRON]();
      expect(mockClientQuery).toHaveBeenCalledTimes(3); // still only original 3

      // Advance past the 15-min reschedule window
      vi.advanceTimersByTime(15 * 60 * 1000);
      mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // candidate only
      mockClientQuery
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({});
      await cronCallbacks[FAST_CRON]();
      expect(mockClientQuery).toHaveBeenCalledTimes(8); // 3 + 5 new
    } finally {
      vi.useRealTimers();
    }
  });

  it('daily cron marks reconciliation as due', async () => {
    vi.useFakeTimers();
    try {
      startUsageLimitEnforcementJob();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

      // First tick: init (1) + candidate (1) = 2 pool queries, startup reconciliation runs
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      mockClientQuery
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({});
      await cronCallbacks[FAST_CRON]();
      mockClientQuery.mockReset();

      // Second tick: watermark already set, only 1 pool query (candidate)
      mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // candidate, no candidates
      await cronCallbacks[FAST_CRON]();
      expect(mockClientQuery).not.toHaveBeenCalled();

      // Daily cron fires — marks reconciliation due
      cronCallbacks[DAILY_CRON]();

      // Third tick: only 1 pool query (candidate), then reconciliation
      mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // candidate
      mockClientQuery
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({});
      await cronCallbacks[FAST_CRON]();

      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
    } finally {
      vi.useRealTimers();
    }
  });
});
