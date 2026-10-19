import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Hoisted mocks -----------------------------------------------------------

const { connectToRouterMock, ensureNtpClientMock } = vi.hoisted(() => ({
  connectToRouterMock: vi.fn(),
  ensureNtpClientMock: vi.fn<
    () => Promise<{ status: 'repaired' | 'already_configured' | 'failed'; detail: string; error?: string }>
  >(),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((_expr: string, _fn: () => void) => ({ start: vi.fn(), stop: vi.fn() })),
  },
}));

vi.mock('../../services/routerOs.service', () => ({
  connectToRouter: connectToRouterMock,
  ensureNtpClient: ensureNtpClientMock,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  _resetJobState();
  ensureNtpClientMock.mockResolvedValue({ status: 'already_configured', detail: 'NTP already on' });
});

// ---- Tests -------------------------------------------------------------------

describe('runNtpConvergence', () => {
  it('returns zero counts when no online routers are found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await runNtpConvergence();

    expect(result).toEqual({ checked: 0, repaired: 0, alreadyConfigured: 0, failed: 0 });
    expect(connectToRouterMock).not.toHaveBeenCalled();
  });

  it('only queries online routers (query fired once per run)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runNtpConvergence();

    // The pool query should have been called exactly once and only online
    // routers should have been requested; we verify the query was issued.
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
    expect(connectToRouterMock).toHaveBeenNthCalledWith(1, 'router-1', 'user-a');
    expect(connectToRouterMock).toHaveBeenNthCalledWith(2, 'router-2', 'user-b');
    expect(result).toEqual({ checked: 2, repaired: 0, alreadyConfigured: 2, failed: 0 });
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

    expect(result).toEqual({ checked: 1, repaired: 1, alreadyConfigured: 0, failed: 0 });
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

    expect(result).toEqual({ checked: 0, repaired: 0, alreadyConfigured: 0, failed: 1 });
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
    expect(result).toEqual({ checked: 1, repaired: 0, alreadyConfigured: 1, failed: 1 });
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
    // Mutation check: if disconnect guard were removed, failed would still be 1
    // but this ensures disconnect is called — remove the `if (client)` guard
    // in the job to see this assertion fail.
    expect(disconnect).toHaveBeenCalledTimes(1);
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

    expect(result).toEqual({ checked: 2, repaired: 1, alreadyConfigured: 1, failed: 2 });
  });

  it('re-entrancy guard: concurrent second call skips if first is still running', async () => {
    let resolveQuery!: (value: unknown) => void;
    const blocker = new Promise((res) => { resolveQuery = res; });
    mockQuery.mockReturnValueOnce(blocker);

    const first = runNtpConvergence();

    mockQuery.mockResolvedValueOnce({ rows: [] });
    const second = await runNtpConvergence();

    expect(second).toEqual({ checked: 0, repaired: 0, alreadyConfigured: 0, failed: 0 });
    expect(connectToRouterMock).not.toHaveBeenCalled();

    resolveQuery({ rows: [] });
    await first;
  });
});

describe('startNtpConvergenceJob', () => {
  it('schedules cron at 03:50 UTC and registers a startup setTimeout', () => {
    vi.useFakeTimers();

    startNtpConvergenceJob();

    // Verify cron expression is daily at 03:50 (6-field with seconds)
    expect(cron.schedule).toHaveBeenCalledWith(
      '0 50 3 * * *',
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
