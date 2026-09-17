import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mocks before vi.mock() factory functions evaluate.
// ---------------------------------------------------------------------------
const { cronCallbacks, mockLoggerWarn, mockLoggerError, mockLoggerInfo } = vi.hoisted(() => ({
  // Keyed by schedule expression so tests can invoke specific crons by name.
  cronCallbacks: {} as Record<string, () => void | Promise<void>>,
  mockLoggerWarn: vi.fn(),
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
    warn: mockLoggerWarn,
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
  startValidityExpirationJob,
  _resetJobState,
} from '../validityExpiration';
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
const DAILY_CRON = '0 10 2 * * *';

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  _resetJobState();
  mockPoolQuery.mockReset();
  mockClientQuery.mockReset();
  mockLoggerWarn.mockReset();
  mockLoggerError.mockReset();
  mockLoggerInfo.mockReset();
});

// ---------------------------------------------------------------------------
// Fast pass
// ---------------------------------------------------------------------------
describe('validityExpiration fast pass', () => {
  it('passes the candidate username array as $1 to the filtered SQL', async () => {
    startValidityExpirationJob();

    // tracker init + candidate query → one candidate
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ max_id: '100' }] })       // MAX init
      .mockResolvedValueOnce({                                      // candidate
        rows: [{ username: 'user-a', open: true, max_id: '110' }],
      })
      .mockResolvedValueOnce({ rows: [] });                         // fast SQL (no match)

    await cronCallbacks[FAST_CRON]();

    // The third pool.query call should be the fast SQL, with ['user-a'] as $1
    const fastCallArgs = mockPoolQuery.mock.calls[2] as [string, [string[]]];
    expect(fastCallArgs[1][0]).toEqual(['user-a']);
    // Fast SQL must contain the ANY($1) filter
    expect(fastCallArgs[0]).toMatch(/ANY\(\$1::text\[\]\)/i);
  });

  it('skips the enforcement query when there are no candidates', async () => {
    startValidityExpirationJob();

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })   // MAX init
      .mockResolvedValueOnce({ rows: [] });                   // candidate query (empty)

    await cronCallbacks[FAST_CRON]();

    // Only init + candidate (2 calls); no fast SQL call
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
  });

  it('guard blocks a concurrent tick', async () => {
    startValidityExpirationJob();

    // First tick hangs on the watermark init query
    let releaseFirst!: () => void;
    const blocked = new Promise<void>((res) => {
      releaseFirst = res;
    });
    mockPoolQuery.mockReturnValueOnce(
      blocked.then(() => ({ rows: [{ max_id: '0' }] })),
    );

    const tick1 = cronCallbacks[FAST_CRON]();

    // Second tick fires immediately — should return without touching the pool
    const tick2 = cronCallbacks[FAST_CRON]();
    await tick2; // must resolve quickly (guard fires before any await)

    // Only the first tick reached pool.query
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);

    // Allow tick1 to complete cleanly
    releaseFirst();
    mockPoolQuery.mockResolvedValue({ rows: [] }); // remaining queries
    await tick1;
  });

  it('applies Expiration INSERT with correct params from the fast SQL', async () => {
    startValidityExpirationJob();

    const firstLogin = new Date('2026-09-01T10:00:00.000Z');

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })   // MAX init
      .mockResolvedValueOnce({                               // candidate
        rows: [{ username: 'user-b', open: true, max_id: '5' }],
      })
      .mockResolvedValueOnce({                               // fast SQL result
        rows: [{
          radius_username: 'user-b',
          validity_seconds: 86400,
          first_login: firstLogin,
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1 });               // INSERT

    await cronCallbacks[FAST_CRON]();

    // The INSERT call (4th pool.query)
    const insertCall = mockPoolQuery.mock.calls[3] as [string, string[]];
    expect(insertCall[0]).toContain('INSERT INTO radcheck');
    expect(insertCall[0]).toContain('WHERE NOT EXISTS');
    expect(insertCall[1][0]).toBe('user-b');
    expect(insertCall[1][1]).toBe('Expiration');
    expect(insertCall[1][2]).toBe(':=');
    // Expiration value: first_login + 86400s = 2026-09-02T10:00:00Z
    // FreeRADIUS format: "September 02 2026 10:00:00"
    expect(insertCall[1][3]).toBe('September 02 2026 10:00:00');
  });

  it('skips a row with null first_login and logs a warning', async () => {
    startValidityExpirationJob();

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
      .mockResolvedValueOnce({
        rows: [{ username: 'user-c', open: false, max_id: '2' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          radius_username: 'user-c',
          validity_seconds: 3600,
          first_login: null, // <-- null
        }],
      });

    await cronCallbacks[FAST_CRON]();

    // No INSERT should have been attempted
    expect(mockPoolQuery).toHaveBeenCalledTimes(3); // init, candidate, fast SQL only
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('null first_login'),
      expect.objectContaining({ username: 'user-c' }),
    );
  });

  it('does not throw when the fast SQL query fails', async () => {
    startValidityExpirationJob();

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
      .mockResolvedValueOnce({
        rows: [{ username: 'u', open: true, max_id: '1' }],
      })
      .mockRejectedValueOnce(new Error('db error'));

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
describe('validityExpiration reconciliation', () => {
  it('does not run before the startup delay (+3 min)', async () => {
    vi.useFakeTimers();
    try {
      startValidityExpirationJob();

      // Fast pass: no candidates
      mockPoolQuery
        .mockResolvedValue({ rows: [{ max_id: '0' }] })
        // init
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({ rows: [] }); // candidate

      await cronCallbacks[FAST_CRON]();

      // reconciliation must not have started (no client BEGIN calls)
      expect(mockClientQuery).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs on a dedicated client with SET LOCAL statement_timeout after the delay', async () => {
    vi.useFakeTimers();
    try {
      startValidityExpirationJob();

      // Advance time past the 3-min startup delay
      vi.advanceTimersByTime(3 * 60 * 1000 + 1000);

      // Fast pass: no candidates
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      // Reconciliation client sequence: BEGIN, SET LOCAL, SELECT, COMMIT
      mockClientQuery
        .mockResolvedValueOnce({})    // BEGIN
        .mockResolvedValueOnce({})    // SET LOCAL statement_timeout = '300s'
        .mockResolvedValueOnce({ rows: [] }) // recon SELECT (no rows)
        .mockResolvedValueOnce({});   // COMMIT

      await cronCallbacks[FAST_CRON]();

      // Verify client received BEGIN
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');

      // Verify SET LOCAL statement_timeout appears in one of the client calls
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

      // The reconciliation SELECT (3rd client call) must be the UNFILTERED SQL:
      // no candidate filter (the fast SQL uses `ANY($1::text[])`), no bind
      // parameters, and the per-query 310 s client timeout.
      const reconCall = clientCalls[2] as unknown as [unknown, unknown?];
      const recon = reconCall[0] as { text: string; query_timeout?: number; values?: unknown };
      expect(typeof recon).toBe('object');
      expect(recon.text).toContain('MIN(ra.acctstarttime) AS first_login');
      expect(recon.text).not.toContain('ANY(');
      expect(recon.text).not.toContain('$1');
      expect(recon.values).toBeUndefined();
      expect(reconCall[1]).toBeUndefined();
      expect(recon.query_timeout).toBe(310_000);

      // Verify COMMIT
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies rows found during reconciliation', async () => {
    vi.useFakeTimers();
    try {
      startValidityExpirationJob();
      vi.advanceTimersByTime(3 * 60 * 1000 + 1000);

      const firstLogin = new Date('2026-09-10T08:00:00.000Z');

      // Fast pass: no candidates
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      // Reconciliation: returns one row
      mockClientQuery
        .mockResolvedValueOnce({})   // BEGIN
        .mockResolvedValueOnce({})   // SET LOCAL
        .mockResolvedValueOnce({     // recon SELECT
          rows: [{
            radius_username: 'recon-user',
            validity_seconds: 3600,
            first_login: firstLogin,
          }],
        })
        .mockResolvedValueOnce({});  // COMMIT

      // INSERT for the reconciliation row
      mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 });

      await cronCallbacks[FAST_CRON]();

      // Should have called pool.query with INSERT
      const insertCall = mockPoolQuery.mock.calls[2] as [string, string[]];
      expect(insertCall[0]).toContain('INSERT INTO radcheck');
      expect(insertCall[1][0]).toBe('recon-user');
      expect(insertCall[1][1]).toBe('Expiration');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reschedules reconciliation +15 min on failure', async () => {
    vi.useFakeTimers();
    try {
      startValidityExpirationJob();
      vi.advanceTimersByTime(3 * 60 * 1000 + 1000);

      // First tick: init (1) + candidate (1) = 2 pool queries, then reconciliation fails
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })  // watermark init
        .mockResolvedValueOnce({ rows: [] });                  // candidate (no candidates)

      // Reconciliation: BEGIN succeeds, SET LOCAL fails
      mockClientQuery
        .mockResolvedValueOnce({})                      // BEGIN
        .mockRejectedValueOnce(new Error('timeout'))    // SET LOCAL fails
        .mockResolvedValueOnce({});                     // ROLLBACK
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
      // 14 min later: reconciliation NOT yet due (rescheduled for 15 min after failure)
      mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // candidate only
      vi.advanceTimersByTime(14 * 60 * 1000);
      await cronCallbacks[FAST_CRON]();
      // Still no second recon attempt
      expect(mockClientQuery).toHaveBeenCalledTimes(3); // BEGIN + error + ROLLBACK

      // Advance past the 15-min reschedule window (16 min total since failure)
      mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // candidate only
      mockClientQuery
        .mockResolvedValueOnce({})   // BEGIN
        .mockResolvedValueOnce({})   // SET LOCAL
        .mockResolvedValueOnce({ rows: [] }) // SELECT
        .mockResolvedValueOnce({});  // COMMIT
      vi.advanceTimersByTime(2 * 60 * 1000);
      await cronCallbacks[FAST_CRON]();

      // 3 (first failure) + 4 (second reconciliation) = 7
      expect(mockClientQuery).toHaveBeenCalledTimes(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it('daily cron marks reconciliation as due', async () => {
    vi.useFakeTimers();
    try {
      startValidityExpirationJob();
      vi.advanceTimersByTime(3 * 60 * 1000 + 1000);

      // First tick: init (1) + candidate (1) = 2 pool queries, startup reconciliation runs
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      mockClientQuery
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
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

      // Third tick: only 1 pool query (candidate), then reconciliation runs again
      mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // candidate
      mockClientQuery
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({});
      await cronCallbacks[FAST_CRON]();

      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
    } finally {
      vi.useRealTimers();
    }
  });
});
