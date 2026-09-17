import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock factories so they exist before vi.mock() factory functions run.
// ---------------------------------------------------------------------------
const {
  mockSendStatusServer,
  mockGetFreeradiusStartTime,
  mockCaptureMessage,
  mockLoggerError,
  mockLoggerWarn,
  mockLoggerInfo,
} = vi.hoisted(() => ({
  mockSendStatusServer: vi.fn(),
  mockGetFreeradiusStartTime: vi.fn(),
  mockCaptureMessage: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerInfo: vi.fn(),
}));

vi.mock('../radclient.service', () => ({
  sendStatusServer: mockSendStatusServer,
}));

vi.mock('../freeradius.service', () => ({
  getFreeradiusStartTime: mockGetFreeradiusStartTime,
}));

// sentryEnabled=true so the guarded captureMessage branches execute.
vi.mock('../../config/sentry', () => ({
  sentryEnabled: true,
  Sentry: { captureMessage: mockCaptureMessage },
}));

vi.mock('../../config/logger', () => ({
  default: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

import {
  checkFreeradius,
  startFreeradiusMonitor,
  _resetFreeradiusMonitorState,
} from '../freeradiusMonitor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function respondingProbe(latencyMs = 5) {
  return { responding: true, outcome: 'accept' as const, latencyMs };
}

function notRespondingProbe() {
  return { responding: false, outcome: 'timeout' as const, latencyMs: 3001 };
}

// ---------------------------------------------------------------------------
// State + mock reset between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  _resetFreeradiusMonitorState();
  mockSendStatusServer.mockReset();
  mockGetFreeradiusStartTime.mockReset();
  mockCaptureMessage.mockReset();
  mockLoggerError.mockReset();
  mockLoggerWarn.mockReset();
  mockLoggerInfo.mockReset();

  // Default: RADIUS responds, radmin returns a fixed start time.
  mockSendStatusServer.mockResolvedValue(respondingProbe());
  mockGetFreeradiusStartTime.mockResolvedValue('Thu Sep 12 04:10:17 2026');
});

// ---------------------------------------------------------------------------
// Status-Server probe failures / alarm
// ---------------------------------------------------------------------------
describe('Status-Server alarm', () => {
  it('1 failure: no Sentry alert', async () => {
    mockSendStatusServer.mockResolvedValueOnce(notRespondingProbe());

    await checkFreeradius();

    expect(mockCaptureMessage).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('2 consecutive failures: exactly one error alert', async () => {
    mockSendStatusServer.mockResolvedValue(notRespondingProbe());

    await checkFreeradius(); // failure 1
    await checkFreeradius(); // failure 2 → alarm fires

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'FreeRADIUS not answering Status-Server',
      expect.objectContaining({ level: 'error', tags: { monitor: 'freeradius' } }),
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      'freeradiusMonitor: FreeRADIUS not answering Status-Server',
      expect.objectContaining({ consecutiveFailures: 2 }),
    );
  });

  it('3rd consecutive failure: no additional alert (episode still active)', async () => {
    mockSendStatusServer.mockResolvedValue(notRespondingProbe());

    await checkFreeradius();
    await checkFreeradius(); // alarm fires
    await checkFreeradius(); // still failing — must NOT re-fire

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
  });

  it('recovery after alarm: exactly one info alert, alarm resets', async () => {
    mockSendStatusServer.mockResolvedValue(notRespondingProbe());

    await checkFreeradius();
    await checkFreeradius(); // alarm fires

    mockSendStatusServer.mockResolvedValue(respondingProbe());
    await checkFreeradius(); // recovery

    expect(mockCaptureMessage).toHaveBeenCalledTimes(2);
    const calls = mockCaptureMessage.mock.calls;
    expect(calls[1][0]).toBe('FreeRADIUS answering again');
    expect(calls[1][1]).toMatchObject({ level: 'info', tags: { monitor: 'freeradius' } });
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'freeradiusMonitor: FreeRADIUS answering again',
      expect.anything(),
    );
  });

  it('recovery without prior alarm: no info alert', async () => {
    // Only 1 failure, then recovery — no alarm was ever set, so no recovery message.
    mockSendStatusServer.mockResolvedValueOnce(notRespondingProbe());
    await checkFreeradius();

    mockSendStatusServer.mockResolvedValue(respondingProbe());
    await checkFreeradius();

    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// FreeRADIUS restart detection
// ---------------------------------------------------------------------------
describe('restart detection', () => {
  it('first read is baseline only — no restart warning', async () => {
    await checkFreeradius();

    // Only the baseline log should appear; no captureMessage for restart.
    expect(mockCaptureMessage).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'freeradiusMonitor: baseline start time recorded',
      expect.anything(),
    );
  });

  it('same start time on second read — no restart warning', async () => {
    await checkFreeradius(); // baseline
    await checkFreeradius(); // same value

    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('changed start time after baseline — exactly one restart warning', async () => {
    mockGetFreeradiusStartTime.mockResolvedValueOnce('Thu Sep 12 04:10:17 2026'); // baseline
    mockGetFreeradiusStartTime.mockResolvedValueOnce('Fri Sep 13 08:30:00 2026'); // restart

    await checkFreeradius(); // baseline
    await checkFreeradius(); // restart detected

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'FreeRADIUS restarted',
      expect.objectContaining({
        level: 'warning',
        tags: { monitor: 'freeradius' },
        extra: expect.objectContaining({
          previous: 'Thu Sep 12 04:10:17 2026',
          current: 'Fri Sep 13 08:30:00 2026',
        }),
      }),
    );
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'freeradiusMonitor: FreeRADIUS restarted',
      expect.objectContaining({
        previous: 'Thu Sep 12 04:10:17 2026',
        current: 'Fri Sep 13 08:30:00 2026',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Radmin control socket alarm
// ---------------------------------------------------------------------------
describe('radmin control socket alarm', () => {
  it('radmin null x1 and x2 — no alert', async () => {
    mockGetFreeradiusStartTime.mockResolvedValue(null);

    await checkFreeradius(); // failure 1
    await checkFreeradius(); // failure 2

    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('radmin null x3 — exactly one warning', async () => {
    mockGetFreeradiusStartTime.mockResolvedValue(null);

    await checkFreeradius();
    await checkFreeradius();
    await checkFreeradius(); // 3rd → alarm fires

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'FreeRADIUS control socket unreachable',
      expect.objectContaining({ level: 'warning', tags: { monitor: 'freeradius' } }),
    );
  });

  it('radmin null x4 — still only one warning (episode guard)', async () => {
    mockGetFreeradiusStartTime.mockResolvedValue(null);

    await checkFreeradius();
    await checkFreeradius();
    await checkFreeradius(); // alarm fires
    await checkFreeradius(); // still null — must NOT re-fire

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
  });

  it('radmin success resets the failure counter and episode flag', async () => {
    // Build up 3 failures (alarm fires), then succeed.
    mockGetFreeradiusStartTime.mockResolvedValueOnce('T1 baseline') // baseline
    await checkFreeradius(); // baseline

    mockGetFreeradiusStartTime.mockResolvedValue(null);
    await checkFreeradius();
    await checkFreeradius();
    await checkFreeradius(); // alarm fires

    mockGetFreeradiusStartTime.mockResolvedValue('T1 baseline'); // same value, no restart
    await checkFreeradius(); // recovery — failure counter resets

    // Another 3 nulls after recovery should fire the alarm a second time.
    mockGetFreeradiusStartTime.mockResolvedValue(null);
    await checkFreeradius();
    await checkFreeradius();
    await checkFreeradius(); // second alarm

    expect(mockCaptureMessage).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// In-flight guard
// ---------------------------------------------------------------------------
describe('in-flight guard', () => {
  it('second concurrent invocation logs a warning and returns immediately', async () => {
    // Make the first call block indefinitely until we resolve it manually.
    let resolveProbe!: (v: ReturnType<typeof respondingProbe>) => void;
    mockSendStatusServer.mockReturnValueOnce(new Promise((res) => { resolveProbe = res; }));

    const first = checkFreeradius();
    // Immediately call checkFreeradius again — inFlight is true, should bail.
    const second = checkFreeradius();

    // Second resolves immediately (no await on probe).
    await second;
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'freeradiusMonitor: previous tick still running, skipping',
    );
    expect(mockSendStatusServer).toHaveBeenCalledTimes(1); // only the first probe ran

    // Clean up: resolve the first.
    resolveProbe(respondingProbe());
    await first;
  });
});

// ---------------------------------------------------------------------------
// startFreeradiusMonitor
// ---------------------------------------------------------------------------
describe('startFreeradiusMonitor', () => {
  it('returns null when FREERADIUS_MONITOR_INTERVAL_MS is 0', async () => {
    const { config } = await import('../../config');
    const original = config.FREERADIUS_MONITOR_INTERVAL_MS;
    // Temporarily override via Object.defineProperty (config is a plain object).
    Object.defineProperty(config, 'FREERADIUS_MONITOR_INTERVAL_MS', {
      value: 0,
      configurable: true,
      writable: true,
    });

    const handle = startFreeradiusMonitor();
    expect(handle).toBeNull();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'freeradiusMonitor: disabled (FREERADIUS_MONITOR_INTERVAL_MS=0)',
    );

    Object.defineProperty(config, 'FREERADIUS_MONITOR_INTERVAL_MS', {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it('returns a NodeJS.Timeout when interval > 0', async () => {
    const { config } = await import('../../config');
    Object.defineProperty(config, 'FREERADIUS_MONITOR_INTERVAL_MS', {
      value: 9_999_999,
      configurable: true,
      writable: true,
    });

    const handle = startFreeradiusMonitor();
    expect(handle).not.toBeNull();
    clearInterval(handle!);

    Object.defineProperty(config, 'FREERADIUS_MONITOR_INTERVAL_MS', {
      value: 60_000,
      configurable: true,
      writable: true,
    });
  });
});
