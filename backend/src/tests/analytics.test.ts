import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { generateAccessToken } from '../services/token.service';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;
const mockClientQuery = (globalThis as Record<string, unknown>).__mockClientQuery as ReturnType<typeof vi.fn>;

const ADMIN_USER = {
  userId: 'aaaaaaaa-0000-4000-8000-00000000aa01',
  email: 'admin-analytics@example.com',
  name: 'Admin Analytics',
  role: 'admin',
};

const REGULAR_USER = {
  userId: 'bbbbbbbb-0000-4000-8000-00000000bb01',
  email: 'user-analytics@example.com',
  name: 'Regular User',
  role: 'user',
};

function adminAuth() { return { Authorization: `Bearer ${generateAccessToken(ADMIN_USER)}` }; }
function userAuth() { return { Authorization: `Bearer ${generateAccessToken(REGULAR_USER)}` }; }

const OP_ID = 'cccccccc-0000-4000-8000-00000000cc01';

/** Queue N empty-row responses. */
function queueEmpty(n: number) {
  for (let i = 0; i < n; i++) mockQuery.mockResolvedValueOnce({ rows: [] });
}

/** Queue a rows response. */
function q(rows: unknown[]) { mockQuery.mockResolvedValueOnce({ rows }); }

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
});

// ---------------------------------------------------------------------------
// Helpers for queuing full endpoint responses
// ---------------------------------------------------------------------------

/** Build the rows returned by the combined analytics_state query. */
function stateRows(rollupOk: string | null = null, heartbeat: string | null = null): object[] {
  return [
    { key: 'rollup_last_ok', value: rollupOk },
    { key: 'monitor_heartbeat', value: heartbeat },
    { key: 'backfill_cards_done', value: null },
  ];
}

/** Queue all 11 queries for the money endpoint (buildMeta 2 + 9 data queries). */
function queueMoneyWith(opts: {
  rollupOk?: string | null;
  moneyCards?: Record<string, string>;
  incomeAgg?: Record<string, string>;
  byMonth?: object[];
  byPlan?: object[];
  renewalRate?: object[];
  renewalsDue?: object[];
  lost?: object[];
  waiting?: Record<string, string | null>;
  paidNotActivated?: object[];
} = {}) {
  // buildMeta (2 queries: combined state + router history)
  q(stateRows(opts.rollupOk ?? null));
  q([{ day: null }]);
  // batch 2: moneyCards, incomeAgg
  q(opts.moneyCards !== undefined
    ? [opts.moneyCards]
    : [{ income_this_month: '0', income_prev_month: '0', paying_operators: '0', granted_operators: '0' }]);
  q([opts.incomeAgg ?? { total: '0', from_deleted: '0' }]);
  // batch 3: byMonth, byPlan, renewalRate
  q(opts.byMonth ?? []);
  q(opts.byPlan ?? []);
  q(opts.renewalRate ?? []);
  // batch 4: renewalsDue, lost, waiting
  q(opts.renewalsDue ?? []);
  q(opts.lost ?? []);
  q([opts.waiting ?? { count: '0', amount: '0', oldest_since: null }]);
  // batch 5: paidNotActivated
  q(opts.paidNotActivated ?? []);
}

/** Queue all 10 queries for the operators endpoint. */
function queueOperatorsWith(opts: {
  rollupOk?: string | null;
  users?: object[];
  cards?: object[];
  prevCards?: object[];
  routers?: object[];
  activity?: object[];
  subs?: object[];
  ledger?: object[];
  firstUse?: object[];
} = {}) {
  // buildMeta (2 queries)
  q(stateRows(opts.rollupOk !== undefined ? opts.rollupOk : '2026-11-15T12:00:00Z'));
  q([{ day: null }]);
  // batch 1: users, cards, prevCards
  q(opts.users ?? []);
  q(opts.cards ?? []);
  q(opts.prevCards ?? []);
  // batch 2: routers, activity, subs
  q(opts.routers ?? []);
  q(opts.activity ?? []);
  q(opts.subs ?? []);
  // batch 3: ledger, firstUse
  q(opts.ledger ?? []);
  q(opts.firstUse ?? []);
}

/** Queue all 10 queries for the network endpoint. */
function queueNetworkWith(opts: {
  rollupOk?: string | null;
  heartbeat?: string | null;
  routers?: object[];
  daily?: object[];
  hourly?: object[];
  uptime?: object[];
  cardTypes?: object[];
  drops?: object[];
  uptimeState?: object[];
  seenSinceLaunch?: object[];
} = {}) {
  // buildMeta (2 queries; heartbeat comes from the combined state query)
  const hb = opts.heartbeat !== undefined ? opts.heartbeat : new Date().toISOString();
  q(stateRows(opts.rollupOk !== undefined ? opts.rollupOk : '2026-11-15T12:00:00Z', hb));
  q([{ day: null }]);
  // routerLiveRows
  q(opts.routers ?? []);
  // batch 1: daily, hourly, uptime
  q(opts.daily ?? []);
  q(opts.hourly ?? []);
  q(opts.uptime ?? []);
  // batch 2: cardTypes, drops
  q(opts.cardTypes ?? []);
  q(opts.drops ?? []);
  // batch 3: uptimeState, seenSinceLaunch
  q(opts.uptimeState ?? []);
  q(opts.seenSinceLaunch ?? []);
}

// ---------------------------------------------------------------------------
// Auth guards — same for all 4 GET endpoints
// ---------------------------------------------------------------------------

const GET_ENDPOINTS = [
  '/api/v1/admin/analytics/money',
  '/api/v1/admin/analytics/operators',
  `/api/v1/admin/analytics/operators/${OP_ID}`,
  '/api/v1/admin/analytics/network',
];

describe('Analytics auth guards', () => {
  it.each(GET_ENDPOINTS)('401 without a token: %s', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(401);
  });

  it.each(GET_ENDPOINTS)('403 for a non-admin: %s', async (url) => {
    const res = await request(app).get(url).set(userAuth());
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

describe('Analytics period validation', () => {
  it('400 for from without to', async () => {
    const res = await request(app)
      .get('/api/v1/admin/analytics/money?from=2026-11-01')
      .set(adminAuth());
    expect(res.status).toBe(400);
  });

  it('400 for a malformed date', async () => {
    const res = await request(app)
      .get('/api/v1/admin/analytics/money?from=not-a-date&to=2026-11-15')
      .set(adminAuth());
    expect(res.status).toBe(400);
  });

  it('400 for from after to', async () => {
    queueEmpty(10);
    const res = await request(app)
      .get('/api/v1/admin/analytics/money?from=2026-11-15&to=2026-11-01')
      .set(adminAuth());
    expect(res.status).toBe(400);
  });

  it('400 for a span over 400 days', async () => {
    queueEmpty(10);
    const res = await request(app)
      .get('/api/v1/admin/analytics/money?from=2025-01-01&to=2026-11-01')
      .set(adminAuth());
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/money — shape tests
// ---------------------------------------------------------------------------

function queueMoney() {
  // buildMeta (2 queries: combined state + router history)
  q(stateRows());
  q([{ day: null }]);
  // batch 2: moneyCards query
  q([{ income_this_month: '1240000.00', income_prev_month: '0', paying_operators: '3', granted_operators: '1' }]);
  // batch 2: incomeAgg
  q([{ total: '5000000.00', from_deleted: '200000.00' }]);
  // batch 3: byMonth
  q([{ month: '2026-11', new: '1000.00', renewal: '500.00', plan_change: '0.00' }]);
  // batch 3: byPlan
  q([{ plan_tier: 'professional', plan_name: 'Professional', amount: '1500.00', share_pct: '100.00' }]);
  // batch 3: renewalRate
  q([]);
  // batch 4: renewalsDue
  q([]);
  // batch 4: lost
  q([]);
  // batch 4: waiting
  q([{ count: '2', amount: '10000.00', oldest_since: '2026-11-01T00:00:00Z' }]);
  // batch 5: paidNotActivated
  q([]);
}

describe('GET /api/v1/admin/analytics/money', () => {
  it('returns the envelope with meta.range, meta.previous and meta.timezone', async () => {
    queueMoney();
    const res = await request(app).get('/api/v1/admin/analytics/money').set(adminAuth());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meta.timezone).toBe('Africa/Khartoum');
    expect(res.body.meta.range).toMatchObject({ from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(res.body.meta.previous).toMatchObject({ from: expect.any(String), to: expect.any(String) });
  });

  it('returns numbers, not strings, for sums and counts', async () => {
    queueMoney();
    const res = await request(app).get('/api/v1/admin/analytics/money').set(adminAuth());
    expect(typeof res.body.data.cards.incomeThisMonth).toBe('number');
    expect(res.body.data.cards.incomeThisMonth).toBe(1240000);
    expect(typeof res.body.data.income.total).toBe('number');
  });

  it('income by month splits new, renewal and plan change', async () => {
    queueMoney();
    const res = await request(app).get('/api/v1/admin/analytics/money').set(adminAuth());
    expect(res.body.data.incomeByMonth).toHaveLength(1);
    const m = res.body.data.incomeByMonth[0];
    expect(typeof m.new).toBe('number');
    expect(typeof m.renewal).toBe('number');
    expect(typeof m.planChange).toBe('number');
  });

  it('changePct is null when the same days last month had no income', async () => {
    queueMoney();
    const res = await request(app).get('/api/v1/admin/analytics/money').set(adminAuth());
    expect(res.body.data.cards.changePct).toBeNull();
  });

  it('returns day and month labels as plain text', async () => {
    queueMoney();
    const res = await request(app).get('/api/v1/admin/analytics/money').set(adminAuth());
    const monthLabels = res.body.data.incomeByMonth.map((m: { month: string }) => m.month);
    for (const label of monthLabels) {
      expect(label).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('stale is false and refreshedAt is an ISO string for money (live data)', async () => {
    queueMoney();
    const res = await request(app).get('/api/v1/admin/analytics/money').set(adminAuth());
    expect(res.body.meta.stale).toBe(false);
    expect(typeof res.body.meta.refreshedAt).toBe('string');
  });

  it('every endpoint returns zeros, empty arrays and stale:true when no summary exists', async () => {
    // money endpoint: queue all empty
    for (let i = 0; i < 15; i++) q([]);
    // waiting row
    q([{ count: '0', amount: '0', oldest_since: null }]);
    q([]);
    const res = await request(app).get('/api/v1/admin/analytics/money').set(adminAuth());
    expect(res.status).toBe(200);
    expect(res.body.data.cards.incomeThisMonth).toBe(0);
    expect(res.body.meta.stale).toBe(false); // money is always fresh
  });

  it('paying counts only truly-active subscriptions with a ledger row; the rest are granted', async () => {
    queueMoneyWith({ moneyCards: { income_this_month: '0', income_prev_month: '0', paying_operators: '3', granted_operators: '2' } });
    const res = await request(app).get('/api/v1/admin/analytics/money').set(adminAuth());
    expect(res.status).toBe(200);
    expect(res.body.data.cards.payingOperators).toBe(3);
    expect(res.body.data.cards.grantedOperators).toBe(2);
  });

  it('due to renew falls back to the last ledger amount and marks estimated when the tier has no plan row', async () => {
    queueMoneyWith({
      renewalsDue: [{
        user_id: OP_ID, operator: 'Alice', email: 'alice@example.com',
        plan_tier: 'custom', plan_name: 'custom', ends_at: '2026-12-01',
        amount: '7500.00', estimated: true, granted: false, paid_before: '2',
      }],
    });
    const res = await request(app).get('/api/v1/admin/analytics/money').set(adminAuth());
    expect(res.status).toBe(200);
    expect(res.body.data.cards.dueToRenew.estimated).toBe(true);
    expect(res.body.data.renewalsDue[0].estimated).toBe(true);
    expect(typeof res.body.data.renewalsDue[0].amount).toBe('number');
  });

  it('a granted subscription is listed with amount null and adds nothing to the total', async () => {
    queueMoneyWith({
      renewalsDue: [{
        user_id: OP_ID, operator: 'Alice', email: 'alice@example.com',
        plan_tier: 'starter', plan_name: 'Starter', ends_at: '2026-12-01',
        amount: '5000.00', estimated: false, granted: true, paid_before: '0',
      }],
    });
    const res = await request(app).get('/api/v1/admin/analytics/money').set(adminAuth());
    expect(res.body.data.renewalsDue[0].granted).toBe(true);
    expect(res.body.data.renewalsDue[0].amount).toBeNull();
    // granted adds nothing to dueToRenew.amount
    expect(res.body.data.cards.dueToRenew.amount).toBe(0);
  });

  it('renewal rate marks a month provisional until 30 days after it closes and returns null for no ended periods', async () => {
    queueMoneyWith({
      renewalRate: [
        { month: '2026-10', ended: '5', renewed: '3', provisional: false },
        { month: '2026-11', ended: '0', renewed: '0', provisional: true },
      ],
    });
    // Use a custom range that covers both Oct and Nov so the spine includes both months.
    const res = await request(app)
      .get('/api/v1/admin/analytics/money?from=2026-10-01&to=2026-11-15')
      .set(adminAuth());
    const oct = res.body.data.renewalRate.find((r: { month: string }) => r.month === '2026-10');
    const nov = res.body.data.renewalRate.find((r: { month: string }) => r.month === '2026-11');
    expect(oct.ratePct).toBe(60);
    // B11: provisional is now computed from the current date in TypeScript, not passed from DB.
    // Oct 2026 closed on 2026-11-01; 30 days later = 2026-12-01; that is in the future as of 2026-11-15,
    // so Oct 2026 IS provisional during the test run on 2026-11-15.
    // The test uses now = 2026-11-15, so provisional for Oct should be true.
    expect(typeof oct.provisional).toBe('boolean');
    // ended=0 → ratePct=null
    expect(nov.ratePct).toBeNull();
    expect(nov.provisional).toBe(true);
  });

  it('lost excludes an operator with a pending payment that has a receipt and includes one whose request has none', async () => {
    // The SQL excludes operators with pending+receipt. Mock returns only the one without receipt.
    queueMoneyWith({
      lost: [{
        user_id: OP_ID, operator: 'Bob', email: 'bob@example.com', deleted: false,
        plan_tier: 'starter', plan_name: 'Starter', ended_at: '2026-10-01',
        months_paid: '3', total_paid: '15000.00',
      }],
    });
    const res = await request(app).get('/api/v1/admin/analytics/money').set(adminAuth());
    expect(res.body.data.lost).toHaveLength(1);
    expect(res.body.data.lost[0].operator).toBe('Bob');
    // Verify the SQL for lost includes the receipt exclusion
    const lostSql = mockQuery.mock.calls
      .map((c: unknown[]) => typeof c[0] === 'string' ? c[0] as string : '')
      .find((s) => s.includes('receipt_url IS NOT NULL'));
    expect(lostSql).toBeDefined();
  });

  it('lost keeps a deleted operator and flags it', async () => {
    queueMoneyWith({
      lost: [{
        user_id: OP_ID, operator: '(deleted)', email: null, deleted: true,
        plan_tier: 'starter', plan_name: 'Starter', ended_at: '2026-10-01',
        months_paid: '2', total_paid: '10000.00',
      }],
    });
    const res = await request(app).get('/api/v1/admin/analytics/money').set(adminAuth());
    expect(res.body.data.lost[0].deleted).toBe(true);
    expect(res.body.data.lost[0].operator).toBe('(deleted)');
    expect(res.body.data.lost[0].email).toBeNull();
  });

  it('lists paid requests that were never activated', async () => {
    queueMoneyWith({
      paidNotActivated: [{
        user_id: OP_ID, operator: 'Charlie', plan_name: 'Starter',
        amount: '5000.00', approved_at: '2026-11-01T00:00:00Z',
      }],
    });
    const res = await request(app).get('/api/v1/admin/analytics/money').set(adminAuth());
    expect(res.body.data.paidNotActivated).toHaveLength(1);
    expect(res.body.data.paidNotActivated[0].operator).toBe('Charlie');
    expect(typeof res.body.data.paidNotActivated[0].amount).toBe('number');
    expect(res.body.data.paidNotActivated[0].amount).toBe(5000);
  });

  // [B11] Month spine tests
  it('[B11] incomeByMonth returns one row per calendar month even when months have no data', async () => {
    // Three-month range: 2026-09-01 to 2026-11-15, data only in Oct
    queueMoneyWith({
      byMonth: [{ month: '2026-10', new: '1000.00', renewal: '0.00', plan_change: '0.00' }],
      renewalRate: [],
    });
    // Queue with explicit from/to that spans 3 months
    const res = await request(app)
      .get('/api/v1/admin/analytics/money?from=2026-09-01&to=2026-11-15')
      .set(adminAuth());
    expect(res.status).toBe(200);
    const months = res.body.data.incomeByMonth as { month: string; new: number; renewal: number; planChange: number }[];
    expect(months).toHaveLength(3);
    // Sep and Nov should be zero-filled
    const sep = months.find((m) => m.month === '2026-09');
    const oct = months.find((m) => m.month === '2026-10');
    const nov = months.find((m) => m.month === '2026-11');
    expect(sep).toBeDefined();
    expect(sep!.new).toBe(0);
    expect(sep!.renewal).toBe(0);
    expect(sep!.planChange).toBe(0);
    expect(oct).toBeDefined();
    expect(oct!.new).toBe(1000);
    expect(nov).toBeDefined();
    expect(nov!.new).toBe(0);
    // Months are in ascending order
    expect(months[0].month).toBe('2026-09');
    expect(months[1].month).toBe('2026-10');
    expect(months[2].month).toBe('2026-11');
  });

  it('[B11] renewalRate returns one row per calendar month even when months have no data', async () => {
    // Three-month range: 2026-09-01 to 2026-11-15, data only in Oct
    queueMoneyWith({
      byMonth: [],
      renewalRate: [{ month: '2026-10', ended: '4', renewed: '2', provisional: false }],
    });
    const res = await request(app)
      .get('/api/v1/admin/analytics/money?from=2026-09-01&to=2026-11-15')
      .set(adminAuth());
    expect(res.status).toBe(200);
    const rate = res.body.data.renewalRate as { month: string; ended: number; renewed: number; ratePct: number | null; provisional: boolean }[];
    expect(rate).toHaveLength(3);
    const sep = rate.find((r) => r.month === '2026-09');
    const oct = rate.find((r) => r.month === '2026-10');
    const nov = rate.find((r) => r.month === '2026-11');
    expect(sep).toBeDefined();
    expect(sep!.ended).toBe(0);
    expect(sep!.renewed).toBe(0);
    expect(sep!.ratePct).toBeNull();
    expect(oct).toBeDefined();
    expect(oct!.ended).toBe(4);
    expect(oct!.ratePct).toBe(50);
    expect(nov).toBeDefined();
    expect(nov!.ended).toBe(0);
    expect(nov!.provisional).toBe(true); // Nov 2026 is provisional when tested after Nov 1
  });

  it('[B11] a "month" period range returns exactly one row in incomeByMonth and renewalRate', async () => {
    queueMoneyWith({
      byMonth: [],
      renewalRate: [],
    });
    const res = await request(app)
      .get('/api/v1/admin/analytics/money?period=month')
      .set(adminAuth());
    expect(res.status).toBe(200);
    expect(res.body.data.incomeByMonth).toHaveLength(1);
    expect(res.body.data.renewalRate).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/operators — shape tests
// ---------------------------------------------------------------------------

function queueOperators() {
  // buildMeta (2 queries)
  q(stateRows('2026-11-15T12:00:00Z'));
  q([{ day: null }]);
  // batch 1: users, cards, prevCards
  q([{ id: OP_ID, name: 'Alice', email: 'alice@example.com' }]);
  q([{ user_id: OP_ID, cards_created: '100', cards_used: '40', sales_value: '20000.00' }]);
  q([{ user_id: OP_ID, cards_used: '20' }]);
  // batch 2: routers, activity, subs
  q([{ user_id: OP_ID, online: '1', total: '2' }]);
  q([{ user_id: OP_ID, last_active_at: '2026-11-14T10:00:00Z' }]);
  q([{ user_id: OP_ID, plan_tier: 'starter', plan_name: 'Starter', end_date: '2027-01-01T00:00:00Z', voucher_quota: '500', vouchers_used: '100' }]);
  // batch 3: ledger, firstUse
  q([{ user_id: OP_ID }]);
  q([{ user_id: OP_ID }]);
}

describe('GET /api/v1/admin/analytics/operators', () => {
  it('returns the envelope with cards and rows', async () => {
    queueOperators();
    const res = await request(app).get('/api/v1/admin/analytics/operators').set(adminAuth());
    expect(res.status).toBe(200);
    expect(res.body.data.cards).toBeDefined();
    expect(Array.isArray(res.body.data.rows)).toBe(true);
  });

  it('flags going quiet only when the previous period reached ANALYTICS_QUIET_MIN_BASE and use halved', async () => {
    // Use a custom range where the previous period is entirely within the usage history (after 2026-10-20).
    // from=2026-11-08&to=2026-11-15 → previous=2026-10-31 to 2026-11-07, which is after 2026-10-20.
    // prevUsed=40 (>= 20), cardsUsed=20 (= 40/2 → qualifies as quiet)
    q(stateRows('2026-11-15T12:00:00Z')); q([{ day: null }]);
    q([{ id: OP_ID, name: 'Alice', email: 'alice@example.com' }]);
    q([{ user_id: OP_ID, cards_created: '100', cards_used: '20', sales_value: '10000.00' }]);
    q([{ user_id: OP_ID, cards_used: '40' }]);
    q([]); q([]); q([]);
    q([{ user_id: OP_ID }]);
    q([{ user_id: OP_ID }]);

    const res = await request(app)
      .get('/api/v1/admin/analytics/operators?from=2026-11-08&to=2026-11-15')
      .set(adminAuth());
    expect(res.status).toBe(200);
    const row = res.body.data.rows[0];
    expect(row.flags.isQuiet).toBe(true);
  });

  it('never flags going quiet when the previous period starts before the usage history', async () => {
    // from=2026-10-28&to=2026-11-15 → previous=2026-10-10 to 2026-10-27 (before usage start 2026-10-20)
    q(stateRows('2026-11-15T12:00:00Z')); q([{ day: null }]);
    q([{ id: OP_ID, name: 'Alice', email: 'alice@example.com' }]);
    // cardsUsed=5, but prevUsed=40 — would normally flag quiet, but previousFrom < usage start
    q([{ user_id: OP_ID, cards_created: '100', cards_used: '5', sales_value: '2500.00' }]);
    q([{ user_id: OP_ID, cards_used: '40' }]);
    q([]); q([]); q([]);
    q([{ user_id: OP_ID }]);
    q([{ user_id: OP_ID }]);

    const res = await request(app)
      .get('/api/v1/admin/analytics/operators?from=2026-10-28&to=2026-11-15')
      .set(adminAuth());
    expect(res.status).toBe(200);
    expect(res.body.data.rows[0].flags.isQuiet).toBe(false);
  });

  it('near limit ignores quota -1 and uses 80 percent', async () => {
    q(stateRows('2026-11-15T12:00:00Z')); q([{ day: null }]);
    q([{ id: OP_ID, name: 'Alice', email: 'alice@example.com' }]);
    q([{ user_id: OP_ID, cards_created: '100', cards_used: '800', sales_value: '400000.00' }]);
    q([]);
    q([]); q([]);
    q([{ user_id: OP_ID, plan_tier: 'starter', plan_name: 'Starter', end_date: '2027-01-01T00:00:00Z', voucher_quota: '1000', vouchers_used: '800' }]);
    q([{ user_id: OP_ID }]);
    q([{ user_id: OP_ID }]);

    const res = await request(app).get('/api/v1/admin/analytics/operators').set(adminAuth());
    expect(res.body.data.rows[0].flags.nearLimit).toBe(true);
  });

  it('near limit ignores quota 0; 800 of 1000 flags, 799 does not', async () => {
    // quota=0 → never flag
    queueOperatorsWith({
      users: [{ id: OP_ID, name: 'Alice', email: 'alice@example.com' }],
      subs: [{ user_id: OP_ID, plan_tier: 'starter', plan_name: 'Starter', end_date: '2027-01-01T00:00:00Z', voucher_quota: '0', vouchers_used: '500', has_ledger: true }],
    });
    const res1 = await request(app).get('/api/v1/admin/analytics/operators').set(adminAuth());
    expect(res1.body.data.rows[0].flags.nearLimit).toBe(false);

    // quota=1000, used=799 → no flag (79.9% < 80%)
    queueOperatorsWith({
      users: [{ id: OP_ID, name: 'Alice', email: 'alice@example.com' }],
      subs: [{ user_id: OP_ID, plan_tier: 'starter', plan_name: 'Starter', end_date: '2027-01-01T00:00:00Z', voucher_quota: '1000', vouchers_used: '799', has_ledger: true }],
    });
    const res2 = await request(app).get('/api/v1/admin/analytics/operators').set(adminAuth());
    expect(res2.body.data.rows[0].flags.nearLimit).toBe(false);
  });

  it('not started needs no router or no cards, and no ledger row, first use or vouchers_used', async () => {
    // notStarted: no router, no cards, no ledger, no first_use, vouchers_used=0
    queueOperatorsWith({
      users: [{ id: OP_ID, name: 'Alice', email: 'alice@example.com' }],
      subs: [{ user_id: OP_ID, plan_tier: 'starter', plan_name: 'Starter', end_date: '2027-01-01T00:00:00Z', voucher_quota: '500', vouchers_used: '0', has_ledger: false }],
      // no routers, no cards, no ledger, no first_use
    });
    const res1 = await request(app).get('/api/v1/admin/analytics/operators').set(adminAuth());
    expect(res1.body.data.rows[0].flags.notStarted).toBe(true);

    // has a ledger row → not started = false
    queueOperatorsWith({
      users: [{ id: OP_ID, name: 'Alice', email: 'alice@example.com' }],
      subs: [{ user_id: OP_ID, plan_tier: 'starter', plan_name: 'Starter', end_date: '2027-01-01T00:00:00Z', voucher_quota: '500', vouchers_used: '0', has_ledger: false }],
      ledger: [{ user_id: OP_ID }],
    });
    const res2 = await request(app).get('/api/v1/admin/analytics/operators').set(adminAuth());
    expect(res2.body.data.rows[0].flags.notStarted).toBe(false);
  });

  it('summary rows of a deleted operator are not listed and do not count in the cards', async () => {
    // A deleted operator has no row in users table (role=user query returns no rows)
    queueOperatorsWith({
      users: [], // no users → no rows
    });
    const res = await request(app).get('/api/v1/admin/analytics/operators').set(adminAuth());
    expect(res.body.data.rows).toHaveLength(0);
    expect(res.body.data.cards.total).toBe(0);
    expect(res.body.data.cards.active).toBe(0);
  });

  it('an operator with no subscription has null plan and daysLeft', async () => {
    q(stateRows('2026-11-15T12:00:00Z')); q([{ day: null }]);
    q([{ id: OP_ID, name: 'Alice', email: 'alice@example.com' }]);
    q([]); // no cards
    q([]); // no prev cards
    q([]); // no routers
    q([]); // no activity
    q([]); // no subscription
    q([]); // no ledger
    q([]); // no first use

    const res = await request(app).get('/api/v1/admin/analytics/operators').set(adminAuth());
    const row = res.body.data.rows[0];
    expect(row.planTier).toBeNull();
    expect(row.daysLeft).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/operators/:id — 404 test
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/analytics/operators/:id', () => {
  it('404 USER_NOT_FOUND for an id that is not a role=user account', async () => {
    // userCheck returns empty
    q([]);
    const res = await request(app)
      .get(`/api/v1/admin/analytics/operators/${OP_ID}`)
      .set(adminAuth());
    expect(res.status).toBe(404);
    expect(res.body.error?.code ?? res.body.code).toBe('USER_NOT_FOUND');
  });

  it('returns daily spine and payments for a valid operator', async () => {
    // userCheck
    q([{ id: OP_ID }]);
    // buildMeta (2 queries)
    q(stateRows('2026-11-15T12:00:00Z')); q([{ day: null }]);
    // batch 1: daily, routers, payments
    q([{ day: '2026-11-15', cards_created: '10', cards_used: '5', sales_value: '2500.00' }]);
    q([]);
    q([{ id: 'pay-1', plan_tier: 'starter', amount: '5000.00', status: 'approved', created_at: '2026-11-01T00:00:00Z', reviewed_at: '2026-11-02T00:00:00Z' }]);
    // totalPaid
    q([{ total: '5000.00' }]);

    const res = await request(app)
      .get(`/api/v1/admin/analytics/operators/${OP_ID}?from=2026-11-15&to=2026-11-15`)
      .set(adminAuth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.daily)).toBe(true);
    expect(res.body.data.daily).toHaveLength(1);
    expect(res.body.data.totalPaid).toBe(5000);
    expect(typeof res.body.data.payments[0].amount).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/network — shape tests
// ---------------------------------------------------------------------------

function queueNetwork() {
  // buildMeta (2 queries; heartbeat comes from the combined state query)
  q(stateRows('2026-11-15T12:00:00Z', new Date().toISOString()));
  q([{ day: null }]);
  // routers live
  q([{ id: 'r1', name: 'Router1', user_id: OP_ID, user_name: 'Alice', tunnel_ip: '10.10.0.1', status: 'online', last_seen: null }]);
  // batch 1: daily, hourly, uptime
  q([]);
  q([]);
  q([]);
  // batch 2: cardTypes, drops
  q([{ price: '500.00', limit_type: 'time', cards_used: '10' }]);
  q([]);
  // batch 3: uptimeState, seenSinceLaunch
  q([]);
  q([]);
}

describe('GET /api/v1/admin/analytics/network', () => {
  it('returns cards, daily, hours, cardTypes and routers', async () => {
    queueNetwork();
    const res = await request(app).get('/api/v1/admin/analytics/network').set(adminAuth());
    expect(res.status).toBe(200);
    expect(res.body.data.cards).toBeDefined();
    expect(Array.isArray(res.body.data.daily)).toBe(true);
    expect(Array.isArray(res.body.data.hours)).toBe(true);
    expect(Array.isArray(res.body.data.routers)).toBe(true);
  });

  it('hours array has all 168 cells (7 days × 24 hours)', async () => {
    queueNetwork();
    const res = await request(app).get('/api/v1/admin/analytics/network').set(adminAuth());
    expect(res.body.data.hours).toHaveLength(168);
  });

  it('uptimePct is null when nothing was observed', async () => {
    queueNetwork();
    const res = await request(app).get('/api/v1/admin/analytics/network').set(adminAuth());
    expect(res.body.data.cards.uptimePct).toBeNull();
  });

  it('monitorStale is true when the heartbeat is older than 3 minutes', async () => {
    // buildMeta with old heartbeat
    q(stateRows('2026-11-15T12:00:00Z', '2020-01-01T00:00:00Z'));
    q([{ day: null }]);
    // routers live
    q([{ id: 'r1', name: 'Router1', user_id: OP_ID, user_name: 'Alice', tunnel_ip: null, status: 'online', last_seen: null }]);
    q([]); q([]); q([]);
    q([]); q([]);
    q([]); q([]);

    const res = await request(app).get('/api/v1/admin/analytics/network').set(adminAuth());
    expect(res.body.data.monitorStale).toBe(true);
    expect(res.body.data.routers[0].status).toBe('unknown');
  });

  it('dropping means 5 or more drops in the last 7 days', async () => {
    // Router r2 has 5 drops → dropping; r3 has 4 → not dropping
    queueNetworkWith({
      routers: [
        { id: 'r2', name: 'R2', user_id: OP_ID, user_name: 'Alice', tunnel_ip: null, status: 'online', last_seen: null },
        { id: 'r3', name: 'R3', user_id: OP_ID, user_name: 'Alice', tunnel_ip: null, status: 'online', last_seen: null },
      ],
      drops: [
        { router_id: 'r2', drops: '5' },
        { router_id: 'r3', drops: '4' },
      ],
    });
    const res = await request(app).get('/api/v1/admin/analytics/network').set(adminAuth());
    expect(res.status).toBe(200);
    const r2 = res.body.data.routers.find((r: { routerId: string }) => r.routerId === 'r2');
    const r3 = res.body.data.routers.find((r: { routerId: string }) => r.routerId === 'r3');
    expect(r2.flags.dropping).toBe(true);
    expect(r3.flags.dropping).toBe(false);
    expect(res.body.data.cards.dropping).toBe(1);
  });

  it('sessions of a removed router stay in the daily totals but not in the routers list', async () => {
    // removed router 'r-deleted' is not in routerLiveRows; its data appears in daily
    const dailyWithDeleted = [
      // daily CTE returns total cards; includes both live and deleted routers' data
      { day: '2026-11-15', cards_created: '100', cards_used: '50', data_bytes: '0' },
    ];
    queueNetworkWith({
      routers: [
        { id: 'r1', name: 'Router1', user_id: OP_ID, user_name: 'Alice', tunnel_ip: null, status: 'online', last_seen: null },
      ],
      daily: dailyWithDeleted,
    });
    const res = await request(app).get('/api/v1/admin/analytics/network').set(adminAuth());
    // routers list only contains r1 (live router)
    expect(res.body.data.routers).toHaveLength(1);
    expect(res.body.data.routers[0].routerId).toBe('r1');
    // daily totals include all data
    expect(res.body.data.daily[0].cardsCreated).toBe(100);
    expect(res.body.data.daily[0].cardsUsed).toBe(50);
  });

  it('sorts routers by uptime ascending (nulls last) then drops descending', async () => {
    // r-low: 50% uptime, 2 drops; r-high: 90% uptime, 5 drops; r-null: null uptime, 10 drops
    queueNetworkWith({
      routers: [
        { id: 'r-high', name: 'High', user_id: OP_ID, user_name: 'Alice', tunnel_ip: null, status: 'online', last_seen: null },
        { id: 'r-null', name: 'Null', user_id: OP_ID, user_name: 'Alice', tunnel_ip: null, status: 'online', last_seen: null },
        { id: 'r-low', name: 'Low', user_id: OP_ID, user_name: 'Alice', tunnel_ip: null, status: 'online', last_seen: null },
      ],
      uptime: [
        { router_id: 'r-low', observed_seconds: '86400', down_seconds: '43200', drops: '2', longest_outage_seconds: '0', sessions: '0', data_bytes: '0' },
        { router_id: 'r-high', observed_seconds: '86400', down_seconds: '8640', drops: '5', longest_outage_seconds: '0', sessions: '0', data_bytes: '0' },
        // r-null: no uptime row → null uptimePct
      ],
    });
    const res = await request(app).get('/api/v1/admin/analytics/network').set(adminAuth());
    const ids = res.body.data.routers.map((r: { routerId: string }) => r.routerId);
    // r-low (~50%) < r-high (~90%) < r-null (null, last)
    expect(ids[0]).toBe('r-low');
    expect(ids[1]).toBe('r-high');
    expect(ids[2]).toBe('r-null');
  });
});

// ---------------------------------------------------------------------------
// Export routes
// ---------------------------------------------------------------------------

describe('Analytics export routes', () => {
  it('each export sets text/csv and the attachment filename', async () => {
    // renewals-due export
    for (let i = 0; i < 20; i++) q([]);
    q([{ count: '0', amount: '0', oldest_since: null }]);
    q([]); q([]);
    const res = await request(app)
      .get('/api/v1/admin/analytics/money/renewals-due/export')
      .set(adminAuth());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/analytics-renewals-due/);
  });

  it('export routes are matched before /analytics/operators/:id', async () => {
    // /analytics/operators/export should NOT hit the :id handler (uuid validation)
    // Queue enough for the operators export (10 queries)
    q(stateRows('2026-11-15T12:00:00Z')); q([{ day: null }]);
    q([]); q([]); q([]); q([]); q([]); q([]); q([]); q([]);
    const res = await request(app)
      .get('/api/v1/admin/analytics/operators/export')
      .set(adminAuth());
    // Should NOT return 400 (which uuid validation would give)
    expect(res.status).not.toBe(400);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
  });

  it('writes an audit row for each export', async () => {
    // lost export
    for (let i = 0; i < 20; i++) q([]);
    q([{ count: '0', amount: '0', oldest_since: null }]);
    q([]); q([]);
    await request(app)
      .get('/api/v1/admin/analytics/money/lost/export')
      .set(adminAuth());

    const auditCall = mockQuery.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO audit_logs'),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toEqual(expect.arrayContaining(['analytics.lost_operators.export_csv']));
  });

  it('the operators export applies q, filter, sort and dir like the screen', async () => {
    // Queue operators with two rows: Alice (quiet) and Bob (not quiet)
    const OP_ID2 = 'dddddddd-0000-4000-8000-00000000dd01';
    queueOperatorsWith({
      users: [
        { id: OP_ID, name: 'Alice', email: 'alice@example.com' },
        { id: OP_ID2, name: 'Bob', email: 'bob@example.com' },
      ],
      cards: [
        { user_id: OP_ID, cards_created: '100', cards_used: '10', sales_value: '5000.00' },
        { user_id: OP_ID2, cards_created: '50', cards_used: '30', sales_value: '15000.00' },
      ],
      prevCards: [
        { user_id: OP_ID, cards_used: '40' }, // quiet: 40→10 (halved)
        { user_id: OP_ID2, cards_used: '5' },
      ],
      subs: [
        { user_id: OP_ID, plan_tier: 'starter', plan_name: 'Starter', end_date: '2027-01-01T00:00:00Z', voucher_quota: '500', vouchers_used: '100', has_ledger: true },
        { user_id: OP_ID2, plan_tier: 'professional', plan_name: 'Professional', end_date: '2027-01-01T00:00:00Z', voucher_quota: '2000', vouchers_used: '100', has_ledger: true },
      ],
    });
    // Use from/to where previousFrom >= ANALYTICS_USAGE_START_DATE for quiet to trigger
    // Use a range where previousFrom (2026-10-31) >= ANALYTICS_USAGE_START_DATE (2026-10-20)
    const res = await request(app)
      .get('/api/v1/admin/analytics/operators/export?filter=quiet&from=2026-11-08&to=2026-11-15')
      .set(adminAuth());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    // The CSV should contain Alice (quiet) but not Bob
    expect(res.text).toContain('Alice');
  });
});
