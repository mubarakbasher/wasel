import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist ALL variables referenced in vi.mock factories.
// Reads go through withGuardedClient → mockReadClient.
// Writes go through pool.connect() → mockWriteClient.
// ---------------------------------------------------------------------------
const {
  cronTicks,
  mockAnalyticsJobsEnabled,
  mockSetAnalyticsState,
  mockWithGuardedClient,
  mockReadClientQuery,
  mockWriteClientQuery,
  mockWriteClientRelease,
  mockPoolQuery,
  mockPoolConnect,
} = vi.hoisted(() => {
  const mockReadClientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const mockReadClient = { query: mockReadClientQuery };

  const mockWriteClientQuery = vi.fn();
  const mockWriteClientRelease = vi.fn();
  const mockWriteClient = {
    query: mockWriteClientQuery,
    release: mockWriteClientRelease,
  };

  const mockPoolConnect = vi.fn().mockResolvedValue(mockWriteClient);
  const mockPoolQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });

  const mockWithGuardedClient = vi.fn(
    async (fn: (c: unknown) => Promise<unknown>) => fn(mockReadClient),
  );

  return {
    cronTicks: [] as Array<() => void | Promise<void>>,
    mockAnalyticsJobsEnabled: vi.fn().mockReturnValue(true),
    mockSetAnalyticsState: vi.fn().mockResolvedValue(undefined),
    mockWithGuardedClient,
    mockReadClientQuery,
    mockWriteClientQuery,
    mockWriteClientRelease,
    mockPoolQuery,
    mockPoolConnect,
  };
});

// The write client object (returned by pool.connect())
const mockWriteClient = {
  query: mockWriteClientQuery,
  release: mockWriteClientRelease,
};

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
  withGuardedClient: mockWithGuardedClient,
  getAnalyticsState: vi.fn().mockResolvedValue(null),
  setAnalyticsState: mockSetAnalyticsState,
  analyticsJobsEnabled: mockAnalyticsJobsEnabled,
}));

vi.mock('../../config/database', () => ({
  pool: {
    query: mockPoolQuery,
    connect: mockPoolConnect,
  },
}));

vi.mock('../../config', () => ({
  config: {
    ANALYTICS_TZ: 'Africa/Khartoum',
    ANALYTICS_USAGE_START_DATE: '2026-10-20',
  },
}));

import {
  startAnalyticsRollupJob,
  runAnalyticsRollup,
  rebuildUsageHours,
  rebuildCardDay,
  correctCardCounts,
  _resetRollupState,
} from '../analyticsRollup';

beforeEach(() => {
  vi.clearAllMocks();
  cronTicks.length = 0;
  mockAnalyticsJobsEnabled.mockReturnValue(true);
  mockSetAnalyticsState.mockResolvedValue(undefined);
  // Read client: returns empty rows by default
  mockReadClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  // Write client: advisory lock succeeds, all DML returns ok
  mockWriteClientQuery.mockResolvedValue({
    rows: [{ pg_try_advisory_xact_lock: true }],
    rowCount: 0,
  });
  mockWriteClientRelease.mockReset();
  mockPoolConnect.mockResolvedValue(mockWriteClient);
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockWithGuardedClient.mockImplementation(
    async (fn: (c: unknown) => Promise<unknown>) => fn({ query: mockReadClientQuery }),
  );
  _resetRollupState();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analyticsRollup', () => {
  it('issues no query when ANALYTICS_JOBS_ENABLED is false', async () => {
    mockAnalyticsJobsEnabled.mockReturnValue(false);
    await runAnalyticsRollup(new Date('2026-11-15T10:00:00Z'));
    expect(mockWithGuardedClient).not.toHaveBeenCalled();
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it('reads radacct one hour at a time grouped by nasipaddress', async () => {
    // rebuildUsageHours: pool.query for routers, then withGuardedClient for the hour read
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // routers

    await rebuildUsageHours('2026-11-15', [10]);

    expect(mockWithGuardedClient).toHaveBeenCalledOnce();
    const sql = mockReadClientQuery.mock.calls[0][0] as string;
    expect(sql).toContain('GROUP BY nasipaddress');
    // No JOIN in the read SQL — router mapping happens in code
    expect(sql).not.toContain('JOIN routers');
  });

  it('credits a tunnel IP only to a router created before the hour ended', async () => {
    // For hour 10 in Africa/Khartoum (UTC+3):
    // midnight local = 2026-11-14T21:00Z
    // hour 10 start = 2026-11-15T07:00Z, end = 2026-11-15T08:00Z
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'router-old',
          user_id: 'user1',
          tunnel_ip: '10.10.0.1',
          created_at: new Date('2026-11-15T07:30:00Z'), // before hour end (08:00Z)
        },
        {
          id: 'router-new',
          user_id: 'user2',
          tunnel_ip: '10.10.0.2',
          created_at: new Date('2026-11-15T09:00:00Z'), // AFTER hour end
        },
      ],
    });

    mockReadClientQuery.mockResolvedValueOnce({
      rows: [
        { nasipaddress: '10.10.0.1', sessions: '5', data_bytes: '1000' },
        { nasipaddress: '10.10.0.2', sessions: '3', data_bytes: '500' },
      ],
    });

    await rebuildUsageHours('2026-11-15', [10]);

    const inserts = mockWriteClientQuery.mock.calls.filter(
      (c) => (c[0] as string).includes('INSERT INTO analytics_usage_hourly'),
    );
    // Single unnest INSERT — params[2] is the router_id array
    expect(inserts).toHaveLength(1);
    const routerIdArray = inserts[0][1][2] as (string | null)[];
    // router-old maps to 'router-old'; router-new was created after the hour ended → null
    expect(routerIdArray).toContain('router-old');
    expect(routerIdArray).toContain(null);
  });

  it('writes inside one transaction that holds the advisory lock', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // routers

    await rebuildUsageHours('2026-11-15', [10]);

    const writeCalls = mockWriteClientQuery.mock.calls;
    expect(writeCalls[0][0]).toBe('BEGIN');
    const lockCall = writeCalls.find(
      (c) => (c[0] as string).includes('pg_try_advisory_xact_lock'),
    );
    expect(lockCall).toBeDefined();
    const commitCall = writeCalls.find((c) => c[0] === 'COMMIT');
    expect(commitCall).toBeDefined();
  });

  it('[C3] rebuildUsageHours sets statement_timeout=60s inside the write transaction', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // routers
    await rebuildUsageHours('2026-11-15', [10]);
    const writeCalls = mockWriteClientQuery.mock.calls;
    const timeoutCall = writeCalls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('statement_timeout') && (c[0] as string).includes('60s'),
    );
    expect(timeoutCall).toBeDefined();
    // timeout must come after BEGIN but before the advisory lock
    const beginIdx = writeCalls.findIndex((c) => c[0] === 'BEGIN');
    const timeoutIdx = writeCalls.findIndex(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('statement_timeout'),
    );
    const lockIdx = writeCalls.findIndex(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('pg_try_advisory_xact_lock'),
    );
    expect(timeoutIdx).toBeGreaterThan(beginIdx);
    expect(timeoutIdx).toBeLessThan(lockIdx);
  });

  it('[C3] rebuildUsageHours uses unnest INSERT (no per-row inserts) when rows exist', async () => {
    // Provide a router so the hour read returns a mapped row
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 'r1', user_id: 'u1', tunnel_ip: '10.10.0.1',
        created_at: new Date('2026-11-01T00:00:00Z'),
      }],
    });
    mockReadClientQuery.mockResolvedValueOnce({
      rows: [{ nasipaddress: '10.10.0.1', sessions: '5', data_bytes: '1000' }],
    });
    await rebuildUsageHours('2026-11-15', [10]);

    const insertCalls = mockWriteClientQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO analytics_usage_hourly'),
    );
    // exactly one INSERT (unnest batch, not a per-row loop)
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0][0]).toContain('unnest');
  });

  it('[C1] correctCardCounts reads router list from routers table, not voucher_meta', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 'r1' }] }) // routers
      .mockResolvedValueOnce({ rows: [] });            // schema_migrations

    await correctCardCounts('2026-11-15');

    const firstCall = mockPoolQuery.mock.calls[0];
    expect((firstCall[0] as string).trim()).toMatch(/^SELECT id FROM routers/);
    // must NOT scan voucher_meta by created_at outside guarded client
    const voucherMetaOutside = mockPoolQuery.mock.calls.find(
      (c) => (c[0] as string).includes('voucher_meta') && (c[0] as string).includes('DISTINCT router_id'),
    );
    expect(voucherMetaOutside).toBeUndefined();
  });

  it('exits without writing when the advisory lock is taken', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // routers

    // Lock fails; need 3 responses: BEGIN, SET LOCAL statement_timeout, then lock
    mockWriteClientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // SET LOCAL statement_timeout
      .mockResolvedValueOnce({
        rows: [{ pg_try_advisory_xact_lock: false }],
      });

    await rebuildUsageHours('2026-11-15', [10]);

    const rollbackCall = mockWriteClientQuery.mock.calls.find(
      (c) => c[0] === 'ROLLBACK',
    );
    expect(rollbackCall).toBeDefined();
    const deleteCalls = mockWriteClientQuery.mock.calls.filter(
      (c) => (c[0] as string).includes('DELETE FROM analytics_usage_hourly'),
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('the 22:00 UTC run rebuilds all 24 hours of the day that just ended', async () => {
    // At 22:20 UTC (Khartoum 01:20 on 2026-11-16):
    //   today (Khartoum) = 2026-11-16, yesterday = 2026-11-15
    //   utcHour === 22 → rebuild all 24 hours of yesterday (2026-11-15)
    mockPoolQuery.mockResolvedValue({ rows: [] }); // routers (all calls)

    await runAnalyticsRollup(new Date('2026-11-15T22:20:00Z'));

    // Extract the (day, hour) pairs for every radacct read issued via withGuardedClient.
    // Each read passes [hourStart, hourEnd] as params; hourStart encodes the UTC datetime.
    // For Africa/Khartoum (UTC+3), hour h of '2026-11-15' starts at (21 + h) % 24:00 UTC on
    // 2026-11-14 (h<3) or 2026-11-15 (h>=3).  We identify which hours were queried by
    // extracting the UTC hour from the first param of each radacct SQL call.
    const radacctCalls = mockReadClientQuery.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('FROM radacct'),
    );
    // Collect the UTC hour of each hourStart param.
    const utcHours = radacctCalls.map((c: unknown[]) => {
      const params = c[1] as Date[];
      return (params[0] as Date).getUTCHours();
    });
    // Yesterday (2026-11-15) in Khartoum (UTC+3):
    //   hour 0 starts at 2026-11-14T21:00Z (utcH=21), hour 1 at 22Z, hour 2 at 23Z,
    //   hour 3 starts at 2026-11-15T00:00Z (utcH=0), …, hour 23 at 2026-11-15T20:00Z (utcH=20)
    // We expect all 24 Khartoum hours to appear, so utcHours should include 21, 22, 23, 0..20
    const expected24UtcHours = new Set([21, 22, 23, ...Array.from({ length: 21 }, (_, i) => i)]);
    for (const h of expected24UtcHours) {
      expect(utcHours).toContain(h);
    }
    expect(utcHours.length).toBeGreaterThanOrEqual(24);
  });

  it('the 04:00 UTC run rebuilds four earlier days, corrects card counts and prunes hourly rows', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    // The 04:00 run rebuilds 24 hours × 4 days with 100 ms inter-hour delays.
    // Skip real delays by making setTimeout execute its callback synchronously.
    vi.useFakeTimers();
    const rollupPromise = runAnalyticsRollup(new Date('2026-11-15T04:20:00Z'));
    // Advance all pending timers until the promise settles.
    await vi.runAllTimersAsync();
    await rollupPromise;
    vi.useRealTimers();

    // Check that the prune query was issued
    const pruneCall = mockPoolQuery.mock.calls.find(
      (c: unknown[]) => (c[0] as string).includes('DELETE FROM analytics_usage_hourly WHERE day <'),
    );
    expect(pruneCall).toBeDefined();

    // correctCardCounts now takes the router list from the routers table (not voucher_meta)
    const correctQuery = mockPoolQuery.mock.calls.find(
      (c: unknown[]) => (c[0] as string).trim().startsWith('SELECT id FROM routers'),
    );
    expect(correctQuery).toBeDefined();

    // The 04:00 run at 2026-11-15T04:20Z → Khartoum 07:20 → today='2026-11-15'.
    // The 4-day rebuild covers today-1 through today-4:
    //   '2026-11-14', '2026-11-13', '2026-11-12', '2026-11-11'
    // Each rebuildUsageHours call writes hourly rows with day=$1 in a DELETE statement.
    // Count distinct day values passed to DELETE FROM analytics_usage_hourly WHERE day = $1.
    const hourDeleteCalls = mockWriteClientQuery.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('DELETE FROM analytics_usage_hourly WHERE day ='),
    );
    const daysRebuilt = new Set(
      hourDeleteCalls.map((c: unknown[]) => (c[1] as string[])[0]),
    );
    // Must include yesterday and the 3 days before it
    expect(daysRebuilt.has('2026-11-14')).toBe(true);
    expect(daysRebuilt.has('2026-11-13')).toBe(true);
    expect(daysRebuilt.has('2026-11-12')).toBe(true);
    expect(daysRebuilt.has('2026-11-11')).toBe(true);
    // Each of the 4 days must have all 24 hours rebuilt
    expect(hourDeleteCalls.length).toBeGreaterThanOrEqual(4 * 24);
  });

  it('records rollup_last_ok only after a successful run', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const now = new Date('2026-11-15T10:20:00Z');
    await runAnalyticsRollup(now);

    expect(mockSetAnalyticsState).toHaveBeenCalledWith(
      'rollup_last_ok',
      now.toISOString(),
    );
  });

  it('the card-count correction never looks before migration 045 was applied', async () => {
    const migrationDate = new Date('2026-11-01T00:00:00Z');

    mockPoolQuery
      // correctCardCounts: router list from routers table (C1 fix)
      .mockResolvedValueOnce({ rows: [{ id: 'r1' }] })
      // correctCardCounts: schema_migrations
      .mockResolvedValueOnce({ rows: [{ executed_at: migrationDate }] });
      // No more calls: withGuardedClient returns empty → early return

    await correctCardCounts('2026-11-15');

    const migQuery = mockPoolQuery.mock.calls.find(
      (c) =>
        (c[0] as string).includes('schema_migrations') &&
        (c[1] as unknown[])?.[0] === '045_analytics_recording.sql',
    );
    expect(migQuery).toBeDefined();
  });

  it('registers a cron job', () => {
    startAnalyticsRollupJob();
    expect(cronTicks).toHaveLength(1);
  });

  // [C1-test] correctCardCounts requirements
  it('[C1] every statement mentioning voucher_meta goes through withGuardedClient, never pool.query', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 'r1' }] })   // routers
      .mockResolvedValueOnce({ rows: [] });               // schema_migrations

    await correctCardCounts('2026-11-15');

    // pool.query must not have been called with voucher_meta at all
    const poolVmCalls = mockPoolQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('voucher_meta'),
    );
    expect(poolVmCalls).toHaveLength(0);

    // withGuardedClient must have been called with a function that queries voucher_meta
    expect(mockWithGuardedClient).toHaveBeenCalled();
    // The readClientQuery was called with the voucher_meta SELECT
    const vmReadCall = mockReadClientQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('voucher_meta'),
    );
    expect(vmReadCall).toBeDefined();
  });

  it('[C1] correctCardCounts uses router_id = ANY($1::uuid[]) filter on voucher_meta query', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 'r1' }] })   // routers
      .mockResolvedValueOnce({ rows: [] });               // schema_migrations

    await correctCardCounts('2026-11-15');

    const vmRead = mockReadClientQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('voucher_meta'),
    );
    expect(vmRead).toBeDefined();
    expect(vmRead![0] as string).toContain('router_id = ANY($1::uuid[])');
  });

  it('[C1] correctCardCounts produces a "reconcile" batch insert when voucher_meta has cards but card_batches has none', async () => {
    // Setup: pool.query returns routers + migration date;
    //        withGuardedClient returns voucher_meta rows with cnt=5;
    //        pool.query for card_batches returns no rows;
    //        advisory lock succeeds → reconcile INSERT should be issued.
    const migDate = new Date('2026-11-01T00:00:00Z');

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 'r1' }] })                        // routers
      .mockResolvedValueOnce({ rows: [{ executed_at: migDate }] })             // schema_migrations
      .mockResolvedValueOnce({ rows: [] });                                    // card_batches SUM → no rows

    // withGuardedClient returns voucher_meta rows: 5 cards for router r1
    mockWithGuardedClient.mockImplementationOnce(async (fn: (c: unknown) => Promise<unknown>) =>
      fn({
        query: vi.fn().mockResolvedValue({
          rows: [{ router_id: 'r1', user_id: 'u1', price: '50', limit_type: 'time', cnt: '5' }],
          rowCount: 1,
        }),
      }),
    );

    await correctCardCounts('2026-11-15');

    // The write client should have received an INSERT INTO analytics_card_batches with source 'reconcile'
    const reconcileInsert = mockWriteClientQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' &&
             (c[0] as string).includes('INSERT INTO analytics_card_batches') &&
             (c[0] as string).includes("'reconcile'"),
    );
    expect(reconcileInsert).toBeDefined();
  });
});

describe('rebuildCardDay', () => {
  it('inserts from card_batches and card_first_use with IS NOT DISTINCT FROM join', async () => {
    await rebuildCardDay('2026-11-15');

    const writeQueries = mockWriteClientQuery.mock.calls.map((c) => c[0] as string);
    const insertCall = writeQueries.find((s) =>
      s.includes('analytics_card_daily') && s.includes('INSERT'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall).toContain('analytics_card_batches');
    expect(insertCall).toContain('analytics_card_first_use');
    expect(insertCall).toContain('IS NOT DISTINCT FROM');
  });
});
