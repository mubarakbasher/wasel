import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock factories so they exist before vi.mock() factory functions run.
// ---------------------------------------------------------------------------
const { mockListPeers, mockCaptureMessage, mockLoggerError, mockLoggerInfo } = vi.hoisted(() => ({
  mockListPeers: vi.fn(),
  mockCaptureMessage: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerInfo: vi.fn(),
}));

// Mock WireGuard peer listing — the system under test's only I/O besides pg.
vi.mock('../wireguardPeer', () => ({ listPeers: mockListPeers }));

// Mock Sentry with sentryEnabled=true so captureMessage calls actually go through
// the guarded branch. In production this would hit the real Sentry client.
vi.mock('../../config/sentry', () => ({
  sentryEnabled: true,
  Sentry: { captureMessage: mockCaptureMessage },
}));

// Mock notification service — per-router pushes are tested separately.
vi.mock('../notification.service', () => ({
  notifyRouterOffline: vi.fn().mockResolvedValue(undefined),
  notifyRouterOnline: vi.fn().mockResolvedValue(undefined),
}));

// Mock the logger so tests can assert on error/info calls without stdout noise.
vi.mock('../../config/logger', () => ({
  default: {
    info: mockLoggerInfo,
    warn: vi.fn(),
    error: mockLoggerError,
  },
}));

// pool.query is wired up globally by src/tests/setup.ts (pg Pool mock).
const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;

import { checkRouterStatuses, _resetMonitorState } from '../wireguardMonitor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Current unix timestamp in whole seconds. */
const nowS = () => Math.floor(Date.now() / 1000);

/**
 * Build a WgPeerStatus.
 * @param id       - Router identifier (used as the suffix of publicKey and tunnelIp)
 * @param ageSecs  - How many seconds ago the latest handshake occurred. Pass 0 to
 *                   simulate a never-connected peer (latestHandshake = 0).
 */
function makePeer(id: string, ageSecs: number) {
  return {
    publicKey: `key-${id}`,
    latestHandshake: ageSecs === 0 ? 0 : nowS() - ageSecs,
    endpoint: `1.2.3.4:51820`,
    allowedIps: `10.10.0.${id}/32`,
    transferRx: 0,
    transferTx: 0,
  };
}

/**
 * Build a DB router row as returned by pool.query.
 */
function makeRouter(id: string, status: 'online' | 'offline' | 'degraded' = 'online') {
  return {
    id,
    user_id: 'user-1',
    name: `Router-${id}`,
    wg_public_key: `key-${id}`,
    status,
    tunnel_ip: `10.10.0.${id}`,
  };
}

/** Produce an array of stringified IDs from 1..n. */
function range(n: number): string[] {
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

// ---------------------------------------------------------------------------
// State + mock reset between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  // Reset the module-level fleet-alarm counters so each test starts fresh.
  _resetMonitorState();

  mockQuery.mockReset();
  mockCaptureMessage.mockReset();
  mockLoggerError.mockReset();
  mockLoggerInfo.mockReset();
  mockListPeers.mockReset();
});

// ---------------------------------------------------------------------------
// Fleet-offline alarm tests
// ---------------------------------------------------------------------------
describe('fleet-offline alarm', () => {
  /**
   * (a) A sudden halving of online routers (8 → 3 across two ticks) fires the
   * alarm exactly once. A third tick at the same low count must not re-fire.
   *
   * Alarm condition: lastOnlineCount(8) >= MIN_FLEET_FOR_ALARM(5)  AND
   *                  onlineCount(3) <= floor(8 × 0.5) = 4
   */
  it('(a) fires once when online count suddenly halves across two ticks', async () => {
    const allIds = range(8);

    // --- Tick 1: all 8 routers online ---
    mockListPeers.mockResolvedValueOnce(allIds.map((id) => makePeer(id, 30)));
    mockQuery.mockResolvedValueOnce({ rows: allIds.map((id) => makeRouter(id, 'online')) });

    await checkRouterStatuses();

    // No alarm yet — first tick has no lastOnlineCount baseline.
    expect(mockCaptureMessage).not.toHaveBeenCalled();

    // --- Tick 2: collapse to 3 online (ids 1-3), ids 4-8 have stale handshakes ---
    const collapsedPeers = [
      ...allIds.slice(0, 3).map((id) => makePeer(id, 30)),   // recent → online
      ...allIds.slice(3).map((id) => makePeer(id, 300)),      // stale  → offline
    ];
    mockListPeers.mockResolvedValueOnce(collapsedPeers);
    mockQuery.mockResolvedValueOnce({ rows: allIds.map((id) => makeRouter(id, 'online')) });

    await checkRouterStatuses();

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith('WireGuard fleet-offline alarm', 'error');
    expect(mockLoggerError).toHaveBeenCalledWith(
      'WireGuard fleet-offline alarm: online routers collapsed',
      expect.objectContaining({ onlineCount: 3, previousOnlineCount: 8 }),
    );

    // --- Tick 3: fleet still at 3 — alarm must NOT re-fire (episode is active) ---
    mockListPeers.mockResolvedValueOnce(collapsedPeers);
    mockQuery.mockResolvedValueOnce({ rows: allIds.map((id) => makeRouter(id, 'online')) });

    await checkRouterStatuses();

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1); // still exactly one call
  });

  /**
   * (b) A single-router drop in an 8-router fleet (8 → 7) must NOT fire.
   *
   * 7 > floor(8 × 0.5) = 4, so the condition is not met.
   */
  it('(b) does not fire for a single-router drop in a large fleet', async () => {
    const allIds = range(8);

    // --- Tick 1: all 8 online ---
    mockListPeers.mockResolvedValueOnce(allIds.map((id) => makePeer(id, 30)));
    mockQuery.mockResolvedValueOnce({ rows: allIds.map((id) => makeRouter(id, 'online')) });

    await checkRouterStatuses();

    // --- Tick 2: one router drops (id '8' goes stale) ---
    const oneDownPeers = [
      ...allIds.slice(0, 7).map((id) => makePeer(id, 30)),
      makePeer('8', 300), // offline
    ];
    mockListPeers.mockResolvedValueOnce(oneDownPeers);
    mockQuery.mockResolvedValueOnce({ rows: allIds.map((id) => makeRouter(id, 'online')) });

    await checkRouterStatuses();

    expect(mockCaptureMessage).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalledWith(
      'WireGuard fleet-offline alarm: online routers collapsed',
      expect.anything(),
    );
  });

  /**
   * (c) After the fleet recovers, the alarm episode clears so that a subsequent
   * drop can fire the alarm a second time.
   *
   * Recovery threshold: ceil(preDropOnlineCount × 0.8) = ceil(8 × 0.8) = ceil(6.4) = 7.
   * So 7 online in tick 3 clears the episode.
   * Tick 4 drops back to 3: lastOnlineCount = 7, 3 ≤ floor(7 × 0.5) = 3 → fires.
   */
  it('(c) recovery clears the episode so a later drop fires the alarm again', async () => {
    const allIds = range(8);

    // --- Tick 1: 8 online → baseline ---
    mockListPeers.mockResolvedValueOnce(allIds.map((id) => makePeer(id, 30)));
    mockQuery.mockResolvedValueOnce({ rows: allIds.map((id) => makeRouter(id, 'online')) });
    await checkRouterStatuses();
    expect(mockCaptureMessage).not.toHaveBeenCalled();

    // --- Tick 2: collapse to 3 → alarm fires (preDropOnlineCount = 8) ---
    const collapsedPeers = [
      ...allIds.slice(0, 3).map((id) => makePeer(id, 30)),
      ...allIds.slice(3).map((id) => makePeer(id, 300)),
    ];
    mockListPeers.mockResolvedValueOnce(collapsedPeers);
    mockQuery.mockResolvedValueOnce({ rows: allIds.map((id) => makeRouter(id, 'online')) });
    await checkRouterStatuses();
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);

    // --- Tick 3: 7 online → recovery (7 >= ceil(8 × 0.8) = 7) ---
    // fleetAlarmActive clears; lastOnlineCount is set to 7.
    const recoveredPeers = [
      ...allIds.slice(0, 7).map((id) => makePeer(id, 30)),
      makePeer('8', 300),
    ];
    mockListPeers.mockResolvedValueOnce(recoveredPeers);
    mockQuery.mockResolvedValueOnce({ rows: allIds.map((id) => makeRouter(id, 'online')) });
    await checkRouterStatuses();
    // Recovery logged; captureMessage still only 1 (recovery does not re-emit alarm).
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'WireGuard fleet-offline alarm cleared: fleet recovered',
      expect.objectContaining({ onlineCount: 7, preDropOnlineCount: 8 }),
    );

    // --- Tick 4: collapse again to 3 → alarm fires a second time ---
    // lastOnlineCount = 7 >= 5; 3 <= floor(7 × 0.5) = 3; !fleetAlarmActive
    mockListPeers.mockResolvedValueOnce(collapsedPeers);
    mockQuery.mockResolvedValueOnce({ rows: allIds.map((id) => makeRouter(id, 'online')) });
    await checkRouterStatuses();
    expect(mockCaptureMessage).toHaveBeenCalledTimes(2);
    expect(mockLoggerError).toHaveBeenCalledWith(
      'WireGuard fleet-offline alarm: online routers collapsed',
      expect.objectContaining({ onlineCount: 3, previousOnlineCount: 7 }),
    );
  });
});
