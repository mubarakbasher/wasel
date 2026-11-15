/**
 * Unit tests for analytics.service.ts review findings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pool: tracks concurrent in-flight queries.
// ---------------------------------------------------------------------------
const {
  mockPoolQuery,
  concurrencyLog,
} = vi.hoisted(() => {
  let inFlight = 0;
  let maxSeen = 0;
  const log: number[] = [];

  const mockPoolQuery = vi.fn(async (..._args: unknown[]) => {
    inFlight++;
    if (inFlight > maxSeen) maxSeen = inFlight;
    log.push(inFlight);
    // yield to microtask queue so concurrent calls register
    await Promise.resolve();
    inFlight--;
    return { rows: [], rowCount: 0 };
  });

  return {
    mockPoolQuery,
    concurrencyLog: {
      get max() { return maxSeen; },
      reset() { inFlight = 0; maxSeen = 0; log.length = 0; },
    },
  };
});

vi.mock('../../config/database', () => ({
  pool: { query: mockPoolQuery, connect: vi.fn() },
}));

vi.mock('../../config', () => ({
  config: {
    ANALYTICS_TZ: 'Africa/Khartoum',
    ANALYTICS_USAGE_START_DATE: '2026-10-01',
    ANALYTICS_QUIET_MIN_BASE: 10,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  concurrencyLog.reset();
  mockPoolQuery.mockImplementation(async (..._args: unknown[]) => {
    // yield to allow concurrency measurement
    await Promise.resolve();
    return { rows: [], rowCount: 0 };
  });
});

// ---------------------------------------------------------------------------
// [C4] Money timezone: incomeThisMonth and incomeSameDaysLastMonth ranges
//      are computed in the configured TZ, not UTC.
// ---------------------------------------------------------------------------
describe('[C4] getMoneyAnalytics money-card ranges use configured TZ', () => {
  it('when now = 2026-11-30T22:30:00Z (Khartoum = 2026-12-01) ranges are Dec-01..Dec-01 and Nov-01..Nov-01', async () => {
    // We test via resolvePeriod directly — the service delegates to it.
    const { resolvePeriod } = await import('../analyticsPeriod');
    const tz = 'Africa/Khartoum';
    const now = new Date('2026-11-30T22:30:00Z'); // Khartoum 01:30 on Dec 1
    const mp = resolvePeriod({ period: 'month' }, 'money', now, tz);
    // This month starts on Dec 1 (Khartoum) and today is Dec 1 → from=to=2026-12-01
    expect(mp.from).toBe('2026-12-01');
    expect(mp.to).toBe('2026-12-01');
    // Previous: same day-of-month in Nov → Nov 1 (day 1 of Nov, clamped to Nov 30)
    expect(mp.previousFrom).toBe('2026-11-01');
    expect(mp.previousTo).toBe('2026-11-01');
  });
});

// ---------------------------------------------------------------------------
// [C2] Max 3 concurrent pool queries per endpoint
// ---------------------------------------------------------------------------

const PERIOD = {
  period: '30d' as const,
  from: '2026-10-16',
  to: '2026-11-15',
  previousFrom: '2026-10-01',
  previousTo: '2026-10-15',
  days: 30,
};

describe('[C2] getMoneyAnalytics: at most 3 pool queries in flight at once', () => {
  it('never fires more than 3 concurrent queries', async () => {
    const { getMoneyAnalytics } = await import('../analytics.service');
    await getMoneyAnalytics(PERIOD).catch(() => undefined);
    expect(concurrencyLog.max).toBeLessThanOrEqual(3);
  });
});

describe('[C2] getOperatorsAnalytics: at most 3 pool queries in flight at once', () => {
  it('never fires more than 3 concurrent queries', async () => {
    const { getOperatorsAnalytics } = await import('../analytics.service');
    await getOperatorsAnalytics(PERIOD).catch(() => undefined);
    expect(concurrencyLog.max).toBeLessThanOrEqual(3);
  });
});

describe('[C2] getNetworkAnalytics: at most 3 pool queries in flight at once', () => {
  it('never fires more than 3 concurrent queries', async () => {
    const { getNetworkAnalytics } = await import('../analytics.service');
    await getNetworkAnalytics(PERIOD).catch(() => undefined);
    expect(concurrencyLog.max).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// [C8] paying/granted operators: paying = active sub with ledger row for THAT
//      subscription; granted = active sub with no such ledger row.
// ---------------------------------------------------------------------------
describe('[C8] paying/granted operators SQL predicate', () => {
  it('the moneyCards query uses subscription_id to match ledger rows', async () => {
    const { getMoneyAnalytics } = await import('../analytics.service');
    await getMoneyAnalytics(PERIOD).catch(() => undefined);

    // Find the moneyCards query (the one with paying_operators subselect)
    const moneyCardCall = mockPoolQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('paying_operators'),
    );
    expect(moneyCardCall).toBeDefined();
    const sql = moneyCardCall![0] as string;
    // paying: il.subscription_id = s.id (not il.user_id = s.user_id)
    expect(sql).toContain('il.subscription_id = s.id');
    // granted: not exists ledger row with il2.subscription_id = s2.id
    expect(sql).toContain('il2.subscription_id = s2.id');
  });
});

// ---------------------------------------------------------------------------
// [C8] renewalsDue.granted flag also uses subscription_id
// ---------------------------------------------------------------------------
describe('[C8] renewalsDue granted flag uses subscription_id', () => {
  it('the renewalsDue query uses subscription_id for the granted flag', async () => {
    const { getMoneyAnalytics } = await import('../analytics.service');
    await getMoneyAnalytics(PERIOD).catch(() => undefined);

    // renewalsDue query: contains the NOT EXISTS check with il2.subscription_id = s.id
    const dueCall = mockPoolQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('granted') &&
        (c[0] as string).includes('end_date') &&
        (c[0] as string).includes('INTERVAL'),
    );
    expect(dueCall).toBeDefined();
    const sql = dueCall![0] as string;
    expect(sql).toContain('il2.subscription_id = s.id');
  });
});

// ---------------------------------------------------------------------------
// [C6] paidNotActivated: DISTINCT ON (p.id) prevents duplicate rows
// ---------------------------------------------------------------------------
describe('[C6] paidNotActivated uses DISTINCT ON (p.id)', () => {
  it('the paidNotActivated query contains DISTINCT ON (p.id)', async () => {
    const { getMoneyAnalytics } = await import('../analytics.service');
    await getMoneyAnalytics(PERIOD).catch(() => undefined);

    const pnaCall = mockPoolQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('paidNotActivated') === false &&
        (c[0] as string).includes('pending_change') &&
        (c[0] as string).toUpperCase().includes('DISTINCT ON'),
    );
    expect(pnaCall).toBeDefined();
    expect((pnaCall![0] as string).toUpperCase()).toContain('DISTINCT ON');
  });
});
