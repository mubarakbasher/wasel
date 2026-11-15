/**
 * Mocked unit tests for analyticsBackfill.ts
 * Covers F1 (cursor precision), F2 (days step bounds), F3 (resetCards).
 *
 * Does NOT require a real database — uses the globally mocked pg Pool from setup.ts.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ----- Module mocks (hoisted) -----------------------------------------------

vi.mock('../services/analyticsDb', () => ({
  withGuardedClient: vi.fn(),
  getAnalyticsState: vi.fn(),
  setAnalyticsState: vi.fn(),
  analyticsJobsEnabled: vi.fn().mockReturnValue(true),
}));

vi.mock('../jobs/analyticsRollup', () => ({
  rebuildCardDay: vi.fn(),
  rebuildUptimeDay: vi.fn(),
  rebuildUsageHours: vi.fn(),
}));

vi.mock('../jobs/analyticsIngest', () => ({
  ingestBatch: vi.fn(),
}));

vi.mock('../services/analyticsPeriod', () => ({
  khartoumToday: vi.fn(),
  addDays: (d: string, n: number): string => {
    // Deterministic date arithmetic without JS rounding concerns.
    const [y, m, day] = d.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, day + n));
    return dt.toISOString().slice(0, 10);
  },
}));

// ----- Imports after mocks ---------------------------------------------------

import { runBackfill } from '../scripts/analyticsBackfill';
import {
  withGuardedClient,
  getAnalyticsState,
  setAnalyticsState,
} from '../services/analyticsDb';
import { rebuildCardDay, rebuildUptimeDay } from '../jobs/analyticsRollup';
import { khartoumToday } from '../services/analyticsPeriod';

// The global mock pool query set up by src/tests/setup.ts
const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;

const wgc = withGuardedClient as ReturnType<typeof vi.fn>;
const mockGetState = getAnalyticsState as ReturnType<typeof vi.fn>;
const mockSetState = setAnalyticsState as ReturnType<typeof vi.fn>;
const mockRebuildCardDay = rebuildCardDay as ReturnType<typeof vi.fn>;
const mockRebuildUptimeDay = rebuildUptimeDay as ReturnType<typeof vi.fn>;
const mockKhartoumToday = khartoumToday as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// F1 — cursor precision
// ---------------------------------------------------------------------------

describe('[F1] backfillCards cursor precision', () => {
  const PAGE_SIZE = 5000;
  const FULL_TS = '2026-07-23T21:57:16.553510Z'; // microsecond-precise text from Postgres
  const JS_TS = new Date('2026-07-23T21:57:16.553Z').toISOString(); // millisecond-truncated

  beforeEach(() => {
    mockQuery.mockReset();
    wgc.mockReset();
    mockGetState.mockReset();
    mockSetState.mockReset();
  });

  it('cursor saved after first page equals full-precision created_at_text, not JS Date round-trip', async () => {
    // Pool.query sequence: logDbIdentity, schema_migrations, SELECT routers,
    // DELETE old batches, INSERT new batch
    mockQuery
      .mockResolvedValueOnce({ rows: [{ db: 'test', addr: '127.0.0.1' }] })
      .mockResolvedValueOnce({ rows: [{ executed_at: new Date('2026-11-01T00:00:00Z') }] })
      .mockResolvedValueOnce({ rows: [{ id: 'router-1' }] })
      .mockResolvedValueOnce({ rowCount: 0 }) // DELETE old backfill batches
      .mockResolvedValueOnce({ rowCount: 1 }); // INSERT batch group

    // getAnalyticsState: no saved cursor
    mockGetState.mockResolvedValue(null);
    mockSetState.mockResolvedValue(undefined);

    // Build PAGE_SIZE rows all sharing FULL_TS (the boundary case that was lost)
    const firstPageRows = Array.from({ length: PAGE_SIZE }, (_, i) => ({
      created_at: new Date('2026-07-23T21:57:16.553Z'), // JS Date round-trip loses μs
      created_at_text: FULL_TS,
      id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      price: '50',
      limit_type: 'time',
      cnt: String(PAGE_SIZE + 1),
    }));

    // First withGuardedClient: return full page (triggers second page fetch)
    wgc.mockImplementationOnce(
      async (fn: (c: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
        return fn({ query: vi.fn().mockResolvedValue({ rows: firstPageRows }) });
      },
    );

    // Second withGuardedClient: return empty page; capture params to verify cursor
    let capturedSecondPageParams: unknown[] | undefined;
    wgc.mockImplementationOnce(
      async (fn: (c: { query: (sql: string, params: unknown[]) => Promise<unknown> }) => Promise<unknown>) => {
        return fn({
          query: vi.fn().mockImplementation((_sql: string, params: unknown[]) => {
            capturedSecondPageParams = params;
            return Promise.resolve({ rows: [] });
          }),
        });
      },
    );

    await runBackfill({ confirm: true, step: 'cards', ignoreWindow: true, _delayMs: 0 });

    // The cursor saved to analytics_state must use the full-precision text
    const cursorCall = mockSetState.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' && (c[0] as string).startsWith('backfill_cards_router:'),
    );
    expect(cursorCall, 'setAnalyticsState must be called with the router cursor').toBeDefined();
    const savedCursor = cursorCall?.[1] as string;
    expect(savedCursor.startsWith(FULL_TS + '::')).toBe(true);
    // Confirm the old JS-Date behaviour would have produced a different (wrong) cursor
    expect(savedCursor.startsWith(JS_TS + '::')).toBe(false);

    // The second page must receive cursorCreatedAt = FULL_TS as $3
    // params = [routerId, migration045Date, cursorCreatedAt, cursorId, PAGE_SIZE]
    expect(capturedSecondPageParams?.[2]).toBe(FULL_TS);
  });
});

// ---------------------------------------------------------------------------
// F2 — days step start date
// ---------------------------------------------------------------------------

describe('[F2] backfillDays start date', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRebuildCardDay.mockReset();
    mockRebuildUptimeDay.mockReset();
    mockKhartoumToday.mockReset();
  });

  it('calls rebuildCardDay from earliest batch date even when it pre-dates usageStartDate', async () => {
    // usageStartDate defaults to '2026-10-20' via config default.
    // Batch min date is '2026-07-23'.  today forced to '2026-07-23' so only 1 day iterates.
    mockKhartoumToday.mockReturnValue('2026-07-23');

    mockQuery
      .mockResolvedValueOnce({ rows: [{ db: 'test', addr: '127.0.0.1' }] }) // logDbIdentity
      .mockResolvedValueOnce({ rows: [{ d: '2026-07-23' }] }) // MIN(created_at) from batches
      .mockResolvedValueOnce({ rows: [{ d: null }] }); // MIN(tracked_since) from uptime state

    await runBackfill({ confirm: true, step: 'days', ignoreWindow: true, _delayMs: 0 });

    expect(mockRebuildCardDay).toHaveBeenCalledWith('2026-07-23');
    expect(mockRebuildCardDay).toHaveBeenCalledTimes(1);
  });

  it('does not call rebuildUptimeDay when no router is tracked yet', async () => {
    mockKhartoumToday.mockReturnValue('2026-07-23');

    mockQuery
      .mockResolvedValueOnce({ rows: [{ db: 'test', addr: '127.0.0.1' }] })
      .mockResolvedValueOnce({ rows: [{ d: '2026-07-23' }] })
      .mockResolvedValueOnce({ rows: [{ d: null }] }); // null = no tracked router

    await runBackfill({ confirm: true, step: 'days', ignoreWindow: true, _delayMs: 0 });

    expect(mockRebuildUptimeDay).not.toHaveBeenCalled();
  });

  it('calls rebuildUptimeDay only from tracked_since day, not before', async () => {
    // Batches start 2026-07-23; uptime tracked from 2026-07-25; today = 2026-07-25
    mockKhartoumToday.mockReturnValue('2026-07-25');

    mockQuery
      .mockResolvedValueOnce({ rows: [{ db: 'test', addr: '127.0.0.1' }] })
      .mockResolvedValueOnce({ rows: [{ d: '2026-07-23' }] })
      .mockResolvedValueOnce({ rows: [{ d: '2026-07-25' }] });

    await runBackfill({ confirm: true, step: 'days', ignoreWindow: true, _delayMs: 0 });

    // rebuildCardDay runs for all 3 days
    expect(mockRebuildCardDay).toHaveBeenCalledWith('2026-07-23');
    expect(mockRebuildCardDay).toHaveBeenCalledWith('2026-07-24');
    expect(mockRebuildCardDay).toHaveBeenCalledWith('2026-07-25');
    expect(mockRebuildCardDay).toHaveBeenCalledTimes(3);

    // rebuildUptimeDay only for 2026-07-25
    expect(mockRebuildUptimeDay).not.toHaveBeenCalledWith('2026-07-23');
    expect(mockRebuildUptimeDay).not.toHaveBeenCalledWith('2026-07-24');
    expect(mockRebuildUptimeDay).toHaveBeenCalledWith('2026-07-25');
    expect(mockRebuildUptimeDay).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// F3 — resetCards opt-in
// ---------------------------------------------------------------------------

describe('[F3] resetCards', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    wgc.mockReset();
    mockGetState.mockReset();
    mockSetState.mockReset();
  });

  it('resetCards=true + confirm=true deletes backfill batches and state keys before the cards step', async () => {
    // Pool query sequence: logDbIdentity, DELETE batches, DELETE state keys,
    // schema_migrations, SELECT routers (empty → no pages run)
    mockQuery
      .mockResolvedValueOnce({ rows: [{ db: 'test', addr: '127.0.0.1' }] })
      .mockResolvedValueOnce({ rowCount: 7 }) // DELETE analytics_card_batches
      .mockResolvedValueOnce({ rowCount: 4 }) // DELETE analytics_state
      .mockResolvedValueOnce({ rows: [{ executed_at: new Date('2026-11-01T00:00:00Z') }] })
      .mockResolvedValueOnce({ rows: [] }); // SELECT routers — empty, nothing to do

    mockGetState.mockResolvedValue(null);
    mockSetState.mockResolvedValue(undefined);

    await runBackfill({
      confirm: true,
      step: 'cards',
      ignoreWindow: true,
      resetCards: true,
      _delayMs: 0,
    });

    // Both DELETE queries must have been issued
    const deleteBatchCall = mockQuery.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('DELETE FROM analytics_card_batches') &&
        (c[0] as string).includes("source = 'backfill'"),
    );
    expect(deleteBatchCall, 'DELETE analytics_card_batches WHERE source=backfill must be called').toBeDefined();

    const deleteStateCall = mockQuery.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('DELETE FROM analytics_state') &&
        (c[0] as string).includes('backfill_cards_router'),
    );
    expect(deleteStateCall, 'DELETE analytics_state keys must be called').toBeDefined();
  });

  it('resetCards=true + confirm=false (dry run) does NOT delete anything', async () => {
    // Pool queries: only logDbIdentity, schema_migrations, SELECT routers
    mockQuery
      .mockResolvedValueOnce({ rows: [{ db: 'test', addr: '127.0.0.1' }] })
      .mockResolvedValueOnce({ rows: [{ executed_at: new Date('2026-11-01T00:00:00Z') }] })
      .mockResolvedValueOnce({ rows: [] }); // SELECT routers — empty

    mockGetState.mockResolvedValue(null);

    await runBackfill({
      confirm: false,
      step: 'cards',
      ignoreWindow: true,
      resetCards: true,
      _delayMs: 0,
    });

    // No DELETE query should have been executed
    const deleteBatchCall = mockQuery.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('DELETE FROM analytics_card_batches'),
    );
    expect(deleteBatchCall, 'No DELETE must be issued in dry run').toBeUndefined();

    const deleteStateCall = mockQuery.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('DELETE FROM analytics_state') &&
        (c[0] as string).includes('backfill_cards_router'),
    );
    expect(deleteStateCall, 'No DELETE must be issued in dry run').toBeUndefined();
  });
});
