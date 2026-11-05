import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Hoisted mocks (must all be at top level) --------------------------------

const {
  connectToRouterMock,
  ensureNtpClientMock,
  ensureRadiusTimeoutMock,
  isRadiusTimeoutRolloutEnabledMock,
} = vi.hoisted(() => ({
  connectToRouterMock: vi.fn(),
  ensureNtpClientMock: vi.fn<
    () => Promise<{ status: 'repaired' | 'already_configured' | 'failed'; detail: string; error?: string }>
  >(),
  ensureRadiusTimeoutMock: vi.fn<
    () => Promise<{ status: 'already' | 'raised' | 'none' | 'failed'; detail?: string }>
  >(),
  isRadiusTimeoutRolloutEnabledMock: vi.fn(() => false),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((_expr: string, _fn: () => void) => ({ start: vi.fn(), stop: vi.fn() })),
  },
}));

vi.mock('../../services/routerOs.service', () => ({
  connectToRouter: connectToRouterMock,
  ensureNtpClient: ensureNtpClientMock,
  ensureRadiusTimeout: ensureRadiusTimeoutMock,
}));

vi.mock('../../services/radiusTimeoutRollout', () => ({
  isRadiusTimeoutRolloutEnabled: isRadiusTimeoutRolloutEnabledMock,
}));

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;

// Import after mocks so the module picks them up.
import { runNtpConvergence, startNtpConvergenceJob, _resetJobState } from '../ntpConvergence';
import cron from 'node-cron';

// ---- Helpers -----------------------------------------------------------------

function makeDisconnect() {
  return vi.fn().mockResolvedValue(undefined);
}

function makeConn(disconnect = makeDisconnect()) {
  return { client: { disconnect }, api: {} };
}

/** Opts matcher — the job always passes signal + onClient to connectToRouter. */
const anyOpts = expect.objectContaining({
  signal: expect.any(AbortSignal),
  onClient: expect.any(Function),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  _resetJobState();
  ensureNtpClientMock.mockResolvedValue({ status: 'already_configured', detail: 'NTP already on' });
  ensureRadiusTimeoutMock.mockResolvedValue({ status: 'already', detail: 'ok' });
  isRadiusTimeoutRolloutEnabledMock.mockReturnValue(false); // rollout off by default
});

// ---- Tests -------------------------------------------------------------------

describe('runNtpConvergence', () => {
  it('returns zero counts when no online routers are found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await runNtpConvergence();

    expect(result).toMatchObject({ checked: 0, repaired: 0, alreadyConfigured: 0, failed: 0, timedOut: 0 });
    expect(connectToRouterMock).not.toHaveBeenCalled();
  });

  it('only queries online routers (query fired once per run)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runNtpConvergence();

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('iterates two routers and counts alreadyConfigured correctly', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'router-1', user_id: 'user-a', tunnel_ip: '10.10.0.1' },
        { id: 'router-2', user_id: 'user-b', tunnel_ip: '10.10.0.5' },
      ],
    });

    const disconnect1 = makeDisconnect();
    const disconnect2 = makeDisconnect();
    connectToRouterMock
      .mockResolvedValueOnce(makeConn(disconnect1))
      .mockResolvedValueOnce(makeConn(disconnect2));

    const result = await runNtpConvergence();

    expect(connectToRouterMock).toHaveBeenCalledTimes(2);
    expect(connectToRouterMock).toHaveBeenNthCalledWith(1, 'router-1', 'user-a', anyOpts);
    expect(connectToRouterMock).toHaveBeenNthCalledWith(2, 'router-2', 'user-b', anyOpts);
    expect(result).toMatchObject({ checked: 2, repaired: 0, alreadyConfigured: 2, failed: 0 });
    expect(disconnect1).toHaveBeenCalledTimes(1);
    expect(disconnect2).toHaveBeenCalledTimes(1);
  });

  it('counts repaired when ensureNtpClient returns status repaired', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'router-1', user_id: 'user-a', tunnel_ip: '10.10.0.1' }],
    });
    connectToRouterMock.mockResolvedValueOnce(makeConn());
    ensureNtpClientMock.mockResolvedValueOnce({ status: 'repaired', detail: 'NTP enabled' });

    const result = await runNtpConvergence();

    expect(result).toMatchObject({ checked: 1, repaired: 1, alreadyConfigured: 0, failed: 0 });
  });

  it('counts failed when ensureNtpClient returns status failed', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'router-1', user_id: 'user-a', tunnel_ip: '10.10.0.1' }],
    });
    connectToRouterMock.mockResolvedValueOnce(makeConn());
    ensureNtpClientMock.mockResolvedValueOnce({
      status: 'failed',
      detail: 'API error',
      error: 'socket closed',
    });

    const result = await runNtpConvergence();

    expect(result).toMatchObject({ checked: 0, repaired: 0, alreadyConfigured: 0, failed: 1 });
  });

  it('continues processing second router when first router connect throws', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'router-bad', user_id: 'user-a', tunnel_ip: '10.10.0.1' },
        { id: 'router-ok', user_id: 'user-b', tunnel_ip: '10.10.0.5' },
      ],
    });

    const disconnect = makeDisconnect();
    connectToRouterMock
      .mockRejectedValueOnce(new Error('circuit breaker open'))
      .mockResolvedValueOnce(makeConn(disconnect));

    const result = await runNtpConvergence();

    expect(connectToRouterMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ checked: 1, repaired: 0, alreadyConfigured: 1, failed: 1 });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnect is always called in finally even when ensureNtpClient throws', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'router-1', user_id: 'user-a', tunnel_ip: '10.10.0.1' }],
    });
    const disconnect = makeDisconnect();
    connectToRouterMock.mockResolvedValueOnce(makeConn(disconnect));
    ensureNtpClientMock.mockRejectedValueOnce(new Error('unexpected api error'));

    const result = await runNtpConvergence();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(1);
  });

  it('aggregates repaired + alreadyConfigured + failed across mixed results', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'r1', user_id: 'u1', tunnel_ip: '10.10.0.1' },
        { id: 'r2', user_id: 'u2', tunnel_ip: '10.10.0.5' },
        { id: 'r3', user_id: 'u3', tunnel_ip: '10.10.0.9' },
        { id: 'r4', user_id: 'u4', tunnel_ip: '10.10.0.13' },
      ],
    });

    connectToRouterMock
      .mockResolvedValueOnce(makeConn())   // r1 — repaired
      .mockResolvedValueOnce(makeConn())   // r2 — already_configured
      .mockRejectedValueOnce(new Error('timeout'))  // r3 — connect fail
      .mockResolvedValueOnce(makeConn()); // r4 — ensureNtpClient fails

    ensureNtpClientMock
      .mockResolvedValueOnce({ status: 'repaired', detail: 'enabled' })
      .mockResolvedValueOnce({ status: 'already_configured', detail: 'ok' })
      // r3 never calls ensureNtpClient
      .mockResolvedValueOnce({ status: 'failed', detail: 'err', error: 'api error' });

    const result = await runNtpConvergence();

    expect(result).toMatchObject({ checked: 2, repaired: 1, alreadyConfigured: 1, failed: 2 });
  });

  it('skips routers already confirmed on a previous run, but retries failed ones', async () => {
    const rows = [
      { id: 'r-ok', user_id: 'u1', tunnel_ip: '10.10.0.1' },
      { id: 'r-fixed', user_id: 'u2', tunnel_ip: '10.10.0.5' },
      { id: 'r-fail', user_id: 'u3', tunnel_ip: '10.10.0.9' },
    ];
    mockQuery.mockResolvedValue({ rows });
    connectToRouterMock.mockImplementation(async () => makeConn());
    ensureNtpClientMock
      .mockResolvedValueOnce({ status: 'already_configured', detail: 'ok' })
      .mockResolvedValueOnce({ status: 'repaired', detail: 'enabled' })
      .mockResolvedValueOnce({ status: 'failed', detail: 'err', error: 'v6 has no servers' });

    const first = await runNtpConvergence();
    expect(first).toMatchObject({ checked: 2, repaired: 1, alreadyConfigured: 1, failed: 1 });
    expect(connectToRouterMock).toHaveBeenCalledTimes(3);

    // Second pass: only the failed router is contacted again.
    ensureNtpClientMock.mockResolvedValueOnce({ status: 'repaired', detail: 'enabled' });
    const second = await runNtpConvergence();
    expect(connectToRouterMock).toHaveBeenCalledTimes(4);
    expect(connectToRouterMock).toHaveBeenLastCalledWith('r-fail', 'u3', anyOpts);
    expect(second).toMatchObject({ checked: 1, repaired: 1, alreadyConfigured: 0, failed: 0 });

    // Third pass: everything is confirmed, nothing is contacted.
    const third = await runNtpConvergence();
    expect(connectToRouterMock).toHaveBeenCalledTimes(4);
    expect(third).toMatchObject({ checked: 0, repaired: 0, alreadyConfigured: 0, failed: 0 });
  });

  it('a router whose connect threw is retried on the next run', async () => {
    const rows = [{ id: 'r1', user_id: 'u1', tunnel_ip: '10.10.0.1' }];
    mockQuery.mockResolvedValue({ rows });
    connectToRouterMock
      .mockRejectedValueOnce(new Error('circuit breaker open'))
      .mockResolvedValueOnce(makeConn());

    await runNtpConvergence();
    const second = await runNtpConvergence();

    expect(connectToRouterMock).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({ checked: 1, repaired: 0, alreadyConfigured: 1, failed: 0 });
  });

  it('re-entrancy guard: concurrent second call skips if first is still running', async () => {
    let resolveQuery!: (value: unknown) => void;
    const blocker = new Promise((res) => { resolveQuery = res; });
    mockQuery.mockReturnValueOnce(blocker);

    const first = runNtpConvergence();

    mockQuery.mockResolvedValueOnce({ rows: [] });
    const second = await runNtpConvergence();

    expect(second).toMatchObject({ checked: 0, repaired: 0, alreadyConfigured: 0, failed: 0 });
    expect(connectToRouterMock).not.toHaveBeenCalled();

    resolveQuery({ rows: [] });
    await first;
  });

  // ---- Deadline / timeout tests (use real withRouterDeadline + fake timers) ----

  it('connectToRouter never settles → deadline fires, router 2 is processed, running cleared, timedOut=1', async () => {
    vi.useFakeTimers();
    try {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'r1', user_id: 'u1', tunnel_ip: '10.0.0.1' },
          { id: 'r2', user_id: 'u2', tunnel_ip: '10.0.0.2' },
        ],
      });

      // r1 never resolves; r2 succeeds immediately
      connectToRouterMock
        .mockReturnValueOnce(new Promise(() => { /* never resolves */ }))
        .mockResolvedValueOnce(makeConn());

      const perRouterMs = 200;
      const runPromise = runNtpConvergence({ perRouterMs, sweepBudgetMs: 60_000 });

      // Advance past r1's deadline
      await vi.advanceTimersByTimeAsync(perRouterMs + 50);
      const result = await runPromise;

      expect(result.timedOut).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.alreadyConfigured).toBe(1); // r2 succeeded
      expect(connectToRouterMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ensureNtpClient never settles → deadline fires, sweep continues and completes, running cleared', async () => {
    vi.useFakeTimers();
    try {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'r1', user_id: 'u1', tunnel_ip: '10.0.0.1' },
          { id: 'r2', user_id: 'u2', tunnel_ip: '10.0.0.2' },
        ],
      });

      // r1: connect succeeds, ensureNtpClient never resolves
      connectToRouterMock
        .mockResolvedValueOnce(makeConn())
        .mockResolvedValueOnce(makeConn());
      ensureNtpClientMock
        .mockReturnValueOnce(new Promise(() => { /* never resolves */ }))
        .mockResolvedValueOnce({ status: 'already_configured', detail: 'ok' });

      const perRouterMs = 200;
      const runPromise = runNtpConvergence({ perRouterMs, sweepBudgetMs: 60_000 });

      await vi.advanceTimersByTimeAsync(perRouterMs + 50);
      const result = await runPromise;

      expect(result.timedOut).toBe(1);
      expect(result.alreadyConfigured).toBe(1); // r2 succeeded
    } finally {
      vi.useRealTimers();
    }
  });

  it('timed-out router is skipped for 2h then retried', async () => {
    vi.useFakeTimers();
    try {
      const rows = [{ id: 'r1', user_id: 'u1', tunnel_ip: '10.0.0.1' }];
      mockQuery.mockResolvedValue({ rows });

      // Run 1: r1 times out
      connectToRouterMock.mockReturnValueOnce(new Promise(() => { /* never */ }));
      const perRouterMs = 200;
      const run1Promise = runNtpConvergence({ perRouterMs, sweepBudgetMs: 60_000 });
      await vi.advanceTimersByTimeAsync(perRouterMs + 50);
      const run1 = await run1Promise;
      expect(run1.timedOut).toBe(1);

      vi.clearAllMocks();
      ensureNtpClientMock.mockResolvedValue({ status: 'already_configured', detail: 'ok' });
      isRadiusTimeoutRolloutEnabledMock.mockReturnValue(false);

      // Run 2 (within 2h): r1 is still in backoff, skipped
      const run2 = await runNtpConvergence({ perRouterMs, sweepBudgetMs: 60_000 });
      expect(connectToRouterMock).not.toHaveBeenCalled();
      expect(run2.timedOut).toBe(0);
      expect(run2.leftForNextRun).toBe(0); // skipped (backoff), not deferred due to budget

      // Advance past the 2h backoff window
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 100);

      // Run 3: r1 is now eligible again
      connectToRouterMock.mockResolvedValueOnce(makeConn());
      const run3 = await runNtpConvergence({ perRouterMs, sweepBudgetMs: 60_000 });
      expect(connectToRouterMock).toHaveBeenCalledTimes(1);
      expect(run3.alreadyConfigured).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('least-recently-attempted router is processed first', async () => {
    // Run 1: attempt r1 only (r1 fails so it isn't converged)
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', user_id: 'u1', tunnel_ip: '10.0.0.1' }],
    });
    connectToRouterMock.mockResolvedValueOnce(makeConn());
    ensureNtpClientMock.mockResolvedValueOnce({ status: 'failed', detail: 'err' });
    await runNtpConvergence();

    // Run 2: both r1 (recently attempted) and r2 (never attempted)
    // r2 should be processed first because lastAttemptAt = 0
    const callOrder: string[] = [];
    connectToRouterMock.mockImplementation(async (routerId: string) => {
      callOrder.push(routerId);
      return makeConn();
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'r1', user_id: 'u1', tunnel_ip: '10.0.0.1' },
        { id: 'r2', user_id: 'u2', tunnel_ip: '10.0.0.2' },
      ],
    });
    ensureNtpClientMock.mockResolvedValue({ status: 'already_configured', detail: 'ok' });
    await runNtpConvergence();

    expect(callOrder[0]).toBe('r2');
    expect(callOrder[1]).toBe('r1');
  });

  it('sweep budget stops starting new routers and reports leftForNextRun', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'r1', user_id: 'u1', tunnel_ip: '10.0.0.1' },
        { id: 'r2', user_id: 'u2', tunnel_ip: '10.0.0.2' },
        { id: 'r3', user_id: 'u3', tunnel_ip: '10.0.0.3' },
      ],
    });
    connectToRouterMock.mockResolvedValue(makeConn());

    // sweepBudgetMs = -1 → deadline already expired before the first router
    const result = await runNtpConvergence({ perRouterMs: 120_000, sweepBudgetMs: -1 });

    expect(result.leftForNextRun).toBe(3);
    expect(connectToRouterMock).not.toHaveBeenCalled();
  });
});

// ---- RADIUS rollout integration -----------------------------------------------

describe('runNtpConvergence — radius rollout', () => {
  it('rollout off → ensureRadiusTimeout not called, router converges on NTP alone', async () => {
    // isRadiusTimeoutRolloutEnabledMock defaults to false (set in beforeEach)
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', user_id: 'u1', tunnel_ip: '10.0.0.1' }],
    });
    connectToRouterMock.mockResolvedValueOnce(makeConn());

    const result = await runNtpConvergence();

    expect(ensureRadiusTimeoutMock).not.toHaveBeenCalled();
    expect(result.alreadyConfigured).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('rollout on + raised → router converges, radiusRaised=1', async () => {
    isRadiusTimeoutRolloutEnabledMock.mockReturnValue(true);
    ensureRadiusTimeoutMock.mockResolvedValue({ status: 'raised', detail: 'raised to 2s' });

    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', user_id: 'u1', tunnel_ip: '10.0.0.1' }],
    });
    connectToRouterMock.mockResolvedValueOnce(makeConn());

    const result = await runNtpConvergence();

    expect(ensureRadiusTimeoutMock).toHaveBeenCalledOnce();
    expect(result.radiusRaised).toBe(1);
    expect(result.alreadyConfigured).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('rollout on + already → radiusAlready=1, router converges', async () => {
    isRadiusTimeoutRolloutEnabledMock.mockReturnValue(true);
    ensureRadiusTimeoutMock.mockResolvedValue({ status: 'already', detail: 'ok' });

    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', user_id: 'u1', tunnel_ip: '10.0.0.1' }],
    });
    connectToRouterMock.mockResolvedValueOnce(makeConn());

    const result = await runNtpConvergence();

    expect(result.radiusAlready).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('rollout on + failed → router not converged, retried next run, radiusFailed=1', async () => {
    isRadiusTimeoutRolloutEnabledMock.mockReturnValue(true);
    ensureRadiusTimeoutMock.mockResolvedValue({ status: 'failed', detail: 'write failed' });

    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', user_id: 'u1', tunnel_ip: '10.0.0.1' }],
    });
    connectToRouterMock.mockResolvedValueOnce(makeConn());
    ensureNtpClientMock.mockResolvedValueOnce({ status: 'already_configured', detail: 'ok' });

    const result = await runNtpConvergence();

    expect(result.radiusFailed).toBe(1);
    // NTP succeeded → counted in alreadyConfigured + checked; RADIUS failure is
    // recorded in radiusFailed only. `failed` is NOT incremented here because
    // that would inflate totals (checked + failed > routers processed).
    expect(result.failed).toBe(0);
    expect(result.alreadyConfigured).toBe(1); // NTP still counted
    // Totals must add up: checked == repaired + alreadyConfigured
    expect(result.checked).toBe(result.repaired + result.alreadyConfigured);

    // Invariant: every processed router is in exactly one NTP outcome bucket.
    // checked == repaired + alreadyConfigured; failed is for NTP/connect errors only.
    expect(result.checked).toBe(result.repaired + result.alreadyConfigured);

    // Should retry on next run (not in converged set)
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', user_id: 'u1', tunnel_ip: '10.0.0.1' }],
    });
    ensureRadiusTimeoutMock.mockResolvedValue({ status: 'raised', detail: 'raised' });
    connectToRouterMock.mockResolvedValueOnce(makeConn());
    const run2 = await runNtpConvergence();
    expect(connectToRouterMock).toHaveBeenCalledTimes(2); // retried
    expect(run2.radiusRaised).toBe(1);
    expect(run2.failed).toBe(0);
  });
});

describe('startNtpConvergenceJob', () => {
  it('schedules cron hourly at :50', () => {
    vi.useFakeTimers();

    startNtpConvergenceJob();

    expect(cron.schedule).toHaveBeenCalledWith(
      '0 50 * * * *',
      expect.any(Function),
    );

    vi.useRealTimers();
  });

  it('startup pass fires runNtpConvergence after 10 min delay', async () => {
    vi.useFakeTimers();
    mockQuery.mockResolvedValue({ rows: [] });

    startNtpConvergenceJob();

    // Before 10 min — should NOT have run
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    expect(mockQuery).not.toHaveBeenCalled();

    // After 10 min — should have run
    await vi.advanceTimersByTimeAsync(1 * 60 * 1000 + 100);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
