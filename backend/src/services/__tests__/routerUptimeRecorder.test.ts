import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLoggerError } = vi.hoisted(() => ({ mockLoggerError: vi.fn() }));

vi.mock('../../config/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
  },
}));

const mockClientQuery = (globalThis as Record<string, unknown>)
  .__mockClientQuery as ReturnType<typeof vi.fn>;

import {
  planUptimeWrites,
  recordRouterTick,
  _resetRecorderState,
  UptimeState,
  RouterTick,
  UPTIME_CONFIRM_MS,
} from '../routerUptimeRecorder';
import { pool } from '../../config/database';

const NOW = new Date('2026-11-15T12:00:00Z');
const minus = (ms: number) => new Date(NOW.getTime() - ms);

function state(over: Partial<UptimeState> = {}): UptimeState {
  return {
    routerId: 'r1',
    userId: 'u1',
    isUp: true,
    changedAt: minus(60_000),
    untrackedAt: null,
    hasOpenOutage: false,
    ...over,
  };
}

function tick(over: Partial<RouterTick> = {}): RouterTick {
  return {
    id: 'r1',
    userId: 'u1',
    online: true,
    lastSeen: NOW,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Pure reducer
// ---------------------------------------------------------------------------

describe('planUptimeWrites (pure reducer)', () => {
  it('an online router with no state row starts being tracked', () => {
    const w = planUptimeWrites({ states: [], heartbeat: null }, [tick()], NOW);
    expect(w.newStates).toEqual([{ routerId: 'r1', userId: 'u1', trackedSince: NOW }]);
    expect(w.setUp).toEqual([]);
    expect(w.setDown).toEqual([]);
    expect(w.openOutages).toEqual([]);
    expect(w.closeOutages).toEqual([]);
  });

  it('an offline router never seen online is ignored', () => {
    const w = planUptimeWrites(
      { states: [], heartbeat: null },
      [tick({ online: false, lastSeen: null })],
      NOW,
    );
    expect(w.newStates).toEqual([]);
    expect(w.setDown).toEqual([]);
    expect(w.openOutages).toEqual([]);
    expect(w.untrack).toEqual([]);
  });

  it('up → offline marks down and opens no outage yet', () => {
    const w = planUptimeWrites(
      { states: [state({ isUp: true, changedAt: minus(60_000) })], heartbeat: minus(0) },
      [tick({ online: false, lastSeen: minus(60_000) })],
      NOW,
    );
    expect(w.setDown).toEqual([{ routerId: 'r1', changedAt: NOW }]);
    expect(w.openOutages).toEqual([]);
  });

  it('opens the outage after 180 s, back-dated to the last handshake', () => {
    const changedAt = minus(UPTIME_CONFIRM_MS + 1_000);
    const lastSeen = minus(UPTIME_CONFIRM_MS + 60_000); // 1 min before down → within 300 s
    const w = planUptimeWrites(
      { states: [state({ isUp: false, changedAt })], heartbeat: minus(0) },
      [tick({ online: false, lastSeen })],
      NOW,
    );
    expect(w.openOutages).toEqual([{ routerId: 'r1', userId: 'u1', startedAt: lastSeen }]);
  });

  it('falls back to changedAt when the last handshake is unknown or old', () => {
    const changedAt = minus(UPTIME_CONFIRM_MS + 1_000);
    const w = planUptimeWrites(
      { states: [state({ isUp: false, changedAt })], heartbeat: minus(0) },
      [tick({ online: false, lastSeen: null })],
      NOW,
    );
    expect(w.openOutages).toEqual([{ routerId: 'r1', userId: 'u1', startedAt: changedAt }]);

    // Too old → ignored, use changedAt
    const old = minus(UPTIME_CONFIRM_MS + 60 * 60 * 1000);
    const w2 = planUptimeWrites(
      { states: [state({ isUp: false, changedAt })], heartbeat: minus(0) },
      [tick({ online: false, lastSeen: old })],
      NOW,
    );
    expect(w2.openOutages[0].startedAt).toEqual(changedAt);
  });

  it('a blip shorter than 180 s leaves no outage', () => {
    const w = planUptimeWrites(
      { states: [state({ isUp: false, changedAt: minus(30_000), hasOpenOutage: false })], heartbeat: minus(0) },
      [tick({ online: true })],
      NOW,
    );
    expect(w.setUp).toEqual([{ routerId: 'r1', changedAt: NOW }]);
    expect(w.closeOutages).toEqual([]);
    expect(w.openOutages).toEqual([]);
  });

  it('coming back closes the outage as recovered', () => {
    const w = planUptimeWrites(
      {
        states: [state({ isUp: false, changedAt: minus(10 * 60_000), hasOpenOutage: true })],
        heartbeat: minus(0),
      },
      [tick({ online: true })],
      NOW,
    );
    expect(w.setUp).toEqual([{ routerId: 'r1', changedAt: NOW }]);
    expect(w.closeOutages).toEqual([{ routerId: 'r1', endedAt: NOW, reason: 'recovered' }]);
  });

  it('a heartbeat older than 180 s records one gap and restarts pending confirmations', () => {
    const hb = minus(10 * 60_000); // 10 min old
    const changedAt = minus(9 * 60_000); // was confirming an outage
    const w = planUptimeWrites(
      { states: [state({ isUp: false, changedAt, hasOpenOutage: false })], heartbeat: hb },
      [tick({ online: false, lastSeen: null })],
      NOW,
    );
    expect(w.gap).toEqual({ startedAt: hb, endedAt: NOW });
    expect(w.restartConfirmation).toEqual([{ routerId: 'r1', changedAt: NOW }]);
    expect(w.openOutages).toEqual([]);
  });

  it('a router missing from the tick is untracked and its outage closed as removed', () => {
    const w = planUptimeWrites(
      {
        states: [state({ hasOpenOutage: true })],
        heartbeat: minus(0),
      },
      [],
      NOW,
    );
    expect(w.untrack).toEqual([{ routerId: 'r1', at: NOW }]);
    expect(w.closeOutages).toEqual([{ routerId: 'r1', endedAt: NOW, reason: 'removed' }]);
  });
});

// ---------------------------------------------------------------------------
// DB wrapper
// ---------------------------------------------------------------------------

describe('recordRouterTick (db wrapper)', () => {
  beforeEach(() => {
    _resetRecorderState();
    mockClientQuery.mockReset();
    mockLoggerError.mockReset();
    (pool.connect as unknown as ReturnType<typeof vi.spyOn>);
    vi.spyOn(pool, 'connect');
    (pool.connect as ReturnType<typeof vi.fn>).mockClear?.();
  });

  it('writes nothing when peersOk is false', async () => {
    const spy = vi.spyOn(pool, 'connect');
    await recordRouterTick({ peersOk: false, peerCount: 5, routers: [], now: NOW });
    expect(spy).not.toHaveBeenCalled();
  });

  it('writes nothing when the peer list is empty', async () => {
    const spy = vi.spyOn(pool, 'connect');
    await recordRouterTick({ peersOk: true, peerCount: 0, routers: [], now: NOW });
    expect(spy).not.toHaveBeenCalled();
  });

  it('skips a tick while the previous one is still running', async () => {
    // Make the first call hang on its initial query so it stays "in flight"
    // while we fire a second one.
    let release: () => void = () => undefined;
    const pending = new Promise<void>((r) => {
      release = r;
    });
    mockClientQuery.mockImplementation(async () => {
      await pending;
      return { rows: [] };
    });
    const connectSpy = vi.spyOn(pool, 'connect');

    const first = recordRouterTick({
      peersOk: true,
      peerCount: 1,
      routers: [tick()],
      now: NOW,
    });
    // Give the first call a tick to actually call pool.connect
    await Promise.resolve();
    const connectCallsAfterFirst = connectSpy.mock.calls.length;

    const second = recordRouterTick({
      peersOk: true,
      peerCount: 1,
      routers: [tick()],
      now: NOW,
    });
    await second;
    expect(connectSpy.mock.calls.length).toBe(connectCallsAfterFirst);

    release();
    await first;
  });

  it('sets the 3 s statement timeout and 1 s lock timeout before any read', async () => {
    mockClientQuery.mockResolvedValue({ rows: [] });
    await recordRouterTick({ peersOk: true, peerCount: 1, routers: [tick()], now: NOW });

    const calls = mockClientQuery.mock.calls.map((c) => c[0] as string);
    const begin = calls.indexOf('BEGIN');
    const stmt = calls.findIndex((s) => s.includes("statement_timeout = '3s'"));
    const lock = calls.findIndex((s) => s.includes("lock_timeout = '1s'"));
    const firstRead = calls.findIndex((s) => /FROM router_uptime_state/i.test(s));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(stmt).toBeGreaterThan(begin);
    expect(lock).toBeGreaterThan(begin);
    expect(firstRead).toBeGreaterThan(stmt);
    expect(firstRead).toBeGreaterThan(lock);
  });

  it('swallows a database error', async () => {
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql === 'BEGIN') return Promise.resolve({ rows: [] });
      if (sql.startsWith('SET LOCAL')) return Promise.resolve({ rows: [] });
      if (sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
      return Promise.reject(new Error('boom'));
    });
    const releases: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(pool, 'connect').mockImplementation(async () => {
      const release = vi.fn();
      releases.push(release);
      return { query: mockClientQuery, release } as unknown as never;
    });
    await expect(
      recordRouterTick({ peersOk: true, peerCount: 1, routers: [tick()], now: NOW }),
    ).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalled();
    expect(releases[0]).toHaveBeenCalledWith(true);
  });

  it('still records when ANALYTICS_JOBS_ENABLED is false', async () => {
    const prev = process.env.ANALYTICS_JOBS_ENABLED;
    process.env.ANALYTICS_JOBS_ENABLED = 'false';
    mockClientQuery.mockResolvedValue({ rows: [] });
    const spy = vi.spyOn(pool, 'connect');
    await recordRouterTick({ peersOk: true, peerCount: 1, routers: [tick()], now: NOW });
    expect(spy).toHaveBeenCalled();
    process.env.ANALYTICS_JOBS_ENABLED = prev;
  });
});
