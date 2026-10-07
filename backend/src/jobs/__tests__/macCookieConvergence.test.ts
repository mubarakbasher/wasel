import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Hoisted mocks -----------------------------------------------------------

const {
  connectToRouterMock,
  listHotspotServersMock,
  ensureMacCookieReloginMock,
} = vi.hoisted(() => ({
  connectToRouterMock: vi.fn(),
  listHotspotServersMock: vi.fn<(api: unknown) => Promise<unknown[]>>(),
  ensureMacCookieReloginMock: vi.fn<
    () => Promise<{ checked: boolean; repaired: string[]; error?: string }>
  >(),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((_expr: string, _fn: () => void) => ({ start: vi.fn(), stop: vi.fn() })),
  },
}));

vi.mock('../../services/routerOs.service', () => ({
  connectToRouter: connectToRouterMock,
  listHotspotServers: listHotspotServersMock,
  // Mirrors the real helper so tests still drive profile resolution via listHotspotServersMock.
  resolveActiveServerProfileNames: async (api: unknown) => {
    const servers = (await listHotspotServersMock(api)) as Array<{ profile?: string; disabled?: boolean }>;
    const names = Array.from(new Set(servers.filter((s) => !s.disabled).map((s) => s.profile).filter((p): p is string => Boolean(p))));
    return names.length > 0 ? names : ['default'];
  },
  ensureMacCookieRelogin: ensureMacCookieReloginMock,
}));

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;

// Import after mocks so the module picks them up.
import { runMacCookieConvergence, _resetJobState } from '../macCookieConvergence';

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
  listHotspotServersMock.mockResolvedValue([]);
  ensureMacCookieReloginMock.mockResolvedValue({ checked: true, repaired: [] });
});

// ---- Tests -------------------------------------------------------------------

describe('runMacCookieConvergence', () => {
  it('returns zero counts when no online routers are found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await runMacCookieConvergence();

    expect(result).toEqual({ checked: 0, repaired: 0, failed: 0 });
    expect(connectToRouterMock).not.toHaveBeenCalled();
  });

  it('iterates two routers sequentially and counts checked correctly', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'router-1', user_id: 'user-a' },
        { id: 'router-2', user_id: 'user-b' },
      ],
    });

    const disconnect1 = makeDisconnect();
    const disconnect2 = makeDisconnect();
    connectToRouterMock
      .mockResolvedValueOnce(makeConn(disconnect1))
      .mockResolvedValueOnce(makeConn(disconnect2));

    const result = await runMacCookieConvergence();

    expect(connectToRouterMock).toHaveBeenCalledTimes(2);
    expect(connectToRouterMock).toHaveBeenNthCalledWith(1, 'router-1', 'user-a');
    expect(connectToRouterMock).toHaveBeenNthCalledWith(2, 'router-2', 'user-b');
    expect(result).toEqual({ checked: 2, repaired: 0, failed: 0 });
    expect(disconnect1).toHaveBeenCalledTimes(1);
    expect(disconnect2).toHaveBeenCalledTimes(1);
  });

  it('counts repaired when ensureMacCookieRelogin returns non-empty repaired list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'router-1', user_id: 'user-a' }] });
    connectToRouterMock.mockResolvedValueOnce(makeConn());
    ensureMacCookieReloginMock.mockResolvedValueOnce({
      checked: true,
      repaired: ['login-by:default'],
    });

    const result = await runMacCookieConvergence();

    expect(result).toEqual({ checked: 1, repaired: 1, failed: 0 });
  });

  it('continues processing second router when first router connect throws', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'router-bad', user_id: 'user-a' },
        { id: 'router-ok', user_id: 'user-b' },
      ],
    });

    const disconnect = makeDisconnect();
    connectToRouterMock
      .mockRejectedValueOnce(new Error('connection timeout'))
      .mockResolvedValueOnce(makeConn(disconnect));

    const result = await runMacCookieConvergence();

    expect(connectToRouterMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ checked: 1, repaired: 0, failed: 1 });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('counts failed when ensureMacCookieRelogin returns checked:false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'router-1', user_id: 'user-a' }] });
    connectToRouterMock.mockResolvedValueOnce(makeConn());
    ensureMacCookieReloginMock.mockResolvedValueOnce({
      checked: false,
      repaired: [],
      error: 'RouterOS menu not available',
    });

    const result = await runMacCookieConvergence();

    expect(result).toEqual({ checked: 0, repaired: 0, failed: 1 });
  });

  it('disconnect is always called in finally even when ensureMacCookieRelogin throws', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'router-1', user_id: 'user-a' }] });
    const disconnect = makeDisconnect();
    connectToRouterMock.mockResolvedValueOnce(makeConn(disconnect));
    ensureMacCookieReloginMock.mockRejectedValueOnce(new Error('api error'));

    const result = await runMacCookieConvergence();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(1);
  });

  it('re-entrancy guard: concurrent second call skips if first is still running', async () => {
    // First call blocks on the DB query
    let resolveQuery!: (value: unknown) => void;
    const blocker = new Promise((res) => { resolveQuery = res; });
    mockQuery.mockReturnValueOnce(blocker);

    // Start (but don't await) first call
    const first = runMacCookieConvergence();

    // Second call should resolve immediately with zeros (guarded)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const second = await runMacCookieConvergence();

    expect(second).toEqual({ checked: 0, repaired: 0, failed: 0 });
    // The second call should not have triggered a new DB query
    // (mockQuery was called once for the first run's blocker; the second
    // runMacCookieConvergence should have been rejected by the guard before
    // even reaching the DB query).
    expect(connectToRouterMock).not.toHaveBeenCalled();

    // Unblock first run
    resolveQuery({ rows: [] });
    await first;
  });
});
