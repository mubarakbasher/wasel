/**
 * Tests for analyticsBackfill.ts — covers [B10]: usage and days steps include today.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool, mockGetState, mockSetState } = vi.hoisted(() => {
  const mockPool = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn(),
  };
  const mockGetState = vi.fn().mockResolvedValue(null);
  const mockSetState = vi.fn().mockResolvedValue(undefined);
  return { mockPool, mockGetState, mockSetState };
});

vi.mock('../../config/database', () => ({ pool: mockPool }));
vi.mock('../../services/analyticsDb', () => ({
  withGuardedClient: vi.fn(async (fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }),
  ),
  getAnalyticsState: mockGetState,
  setAnalyticsState: mockSetState,
}));
vi.mock('../../config', () => ({
  config: {
    ANALYTICS_TZ: 'Africa/Khartoum',
    ANALYTICS_USAGE_START_DATE: '2026-11-01',
  },
}));

// Stub out the heavy rollup functions called by the backfill steps
vi.mock('../../jobs/analyticsRollup', () => ({
  rebuildUsageHours: vi.fn().mockResolvedValue(undefined),
  rebuildCardDay: vi.fn().mockResolvedValue(undefined),
  rebuildUptimeDay: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../jobs/analyticsIngest', () => ({
  ingestBatch: vi.fn().mockResolvedValue({ read: 0, inserted: 0, nextCursor: 0 }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetState.mockResolvedValue(null);
});

describe('[B10] backfillUsage and backfillDays include today', () => {
  it('usage step processes today (not stopping at yesterday)', async () => {
    const { rebuildUsageHours } = await import('../../jobs/analyticsRollup');
    const { runBackfill } = await import('../analyticsBackfill');

    // dry run first to prime; then confirm run
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ db: 'test', addr: '127.0.0.1' }] }) // logDbIdentity
      .mockResolvedValue({ rows: [], rowCount: 0 });

    // Set now to a specific Khartoum day
    const now = new Date('2026-11-15T10:00:00Z'); // Khartoum 2026-11-15T13:00
    await runBackfill({
      confirm: true,
      step: 'usage',
      ignoreWindow: true,
      _now: now,
      _delayMs: 0,
    });

    const calledDays = (rebuildUsageHours as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );

    // Must include today (2026-11-15) in addition to earlier days
    expect(calledDays).toContain('2026-11-15');
    // Must also include startDate (2026-11-01) since cursor starts there
    expect(calledDays).toContain('2026-11-01');
  });

  it('days step processes today (not stopping at yesterday)', async () => {
    const { rebuildCardDay } = await import('../../jobs/analyticsRollup');
    const { runBackfill } = await import('../analyticsBackfill');

    mockPool.query
      .mockResolvedValueOnce({ rows: [{ db: 'test', addr: '127.0.0.1' }] })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    const now = new Date('2026-11-15T10:00:00Z');
    await runBackfill({
      confirm: true,
      step: 'days',
      ignoreWindow: true,
      _now: now,
      _delayMs: 0,
    });

    const calledDays = (rebuildCardDay as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );

    expect(calledDays).toContain('2026-11-15');
    expect(calledDays).toContain('2026-11-01');
  });
});
