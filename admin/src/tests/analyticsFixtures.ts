/**
 * Shared fixtures for the Analytics page and its tabs.
 *
 * Every function returns a fresh deep copy, so a test may change what it gets
 * without leaking into the next one. Pass `overrides` to replace top-level
 * fields. "Today" in these fixtures is 2026-11-15 (Khartoum).
 *
 * The filled fixtures cover the cases the tabs must draw: a granted renewal
 * with no amount, an estimated amount, a deleted lost operator, a paid request
 * that was never switched on, a provisional month, an operator with no plan
 * and no activity, a router with no uptime yet, and cards with no price.
 * The `empty…` ones are the fresh-deploy answer: zeros, empty lists, null
 * percentages and a stale meta. `staleNetworkFixture` is the network answer
 * while the router monitor is silent.
 */
import type {
  AnalyticsMeta,
  MoneyAnalytics,
  NetworkAnalytics,
  OperatorAnalytics,
  OperatorsAnalytics,
} from '../lib/analytics';

const GB = 1024 ** 3;

function fresh<T>(base: T, overrides: Partial<T>): T {
  return { ...(JSON.parse(JSON.stringify(base)) as T), ...overrides };
}

// --- meta -------------------------------------------------------------------

const META: AnalyticsMeta = {
  timezone: 'Africa/Khartoum',
  period: '3m',
  range: { from: '2026-09-01', to: '2026-11-15' },
  previous: { from: '2026-06-17', to: '2026-08-31' },
  refreshedAt: '2026-11-15T10:20:00.000Z', // 12:20 in Khartoum
  stale: false,
  usageHistoryStart: '2026-10-20',
  routerHistoryStart: '2026-11-10',
  cardHistoryComplete: true,
};

const EMPTY_META: AnalyticsMeta = {
  ...META,
  refreshedAt: null,
  stale: true,
  routerHistoryStart: null,
  cardHistoryComplete: false,
};

export function metaFixture(overrides: Partial<AnalyticsMeta> = {}): AnalyticsMeta {
  return fresh(META, overrides);
}

/** Meta of a deploy whose summary jobs never ran. */
export function emptyMetaFixture(overrides: Partial<AnalyticsMeta> = {}): AnalyticsMeta {
  return fresh(EMPTY_META, overrides);
}

// --- money ------------------------------------------------------------------

const MONEY: MoneyAnalytics = {
  cards: {
    incomeThisMonth: 1_240_000,
    incomeSameDaysLastMonth: 1_050_000,
    changePct: 18.1,
    payingOperators: 41,
    grantedOperators: 3,
    dueToRenew: { amount: 135_000, operators: 3, estimated: true },
    waiting: { count: 2, amount: 170_000, oldestSince: '2026-11-13T08:30:00.000Z' },
  },
  // 1,250,000 + 1,400,000 + 1,240,000
  income: { total: 3_890_000, fromDeletedOperators: 120_000 },
  incomeByMonth: [
    { month: '2026-09', new: 300_000, renewal: 900_000, planChange: 50_000 },
    { month: '2026-10', new: 250_000, renewal: 1_050_000, planChange: 100_000 },
    { month: '2026-11', new: 340_000, renewal: 820_000, planChange: 80_000 },
  ],
  incomeByPlan: [
    { planTier: 'pro', planName: 'Pro', amount: 2_334_000, sharePct: 60 },
    { planTier: 'starter', planName: 'Starter', amount: 1_167_000, sharePct: 30 },
    { planTier: 'enterprise', planName: 'Enterprise', amount: 389_000, sharePct: 10 },
  ],
  renewalRate: [
    { month: '2026-09', ended: 20, renewed: 17, ratePct: 85, provisional: false },
    { month: '2026-10', ended: 24, renewed: 18, ratePct: 75, provisional: true },
    { month: '2026-11', ended: 6, renewed: 3, ratePct: 50, provisional: true },
  ],
  // endsAt ascending
  renewalsDue: [
    {
      userId: 'u-nile',
      operator: 'Cafe Nile',
      email: 'nile@example.com',
      planTier: 'pro',
      planName: 'Pro',
      endsAt: '2026-11-20T21:59:59.000Z',
      amount: 90_000,
      estimated: false,
      granted: false,
      // A count of earlier approved payments, not an amount.
      paidBefore: 6,
    },
    {
      // Tier with no plans row: the name falls back to the tier, the amount is estimated.
      userId: 'u-atbara',
      operator: 'Atbara Net',
      email: null,
      planTier: 'legacy',
      planName: 'legacy',
      endsAt: '2026-11-28T21:59:59.000Z',
      amount: 45_000,
      estimated: true,
      granted: false,
      paidBefore: 1,
    },
    {
      // Granted by an admin without a payment: listed, no amount.
      userId: 'u-kassala',
      operator: 'Kassala Wifi',
      email: 'kassala@example.com',
      planTier: 'starter',
      planName: 'Starter',
      endsAt: '2026-12-05T21:59:59.000Z',
      amount: null,
      estimated: false,
      granted: true,
      paidBefore: 0,
    },
  ],
  // endedAt descending
  lost: [
    {
      userId: 'u-dongola',
      operator: 'Dongola Link',
      email: 'dongola@example.com',
      deleted: false,
      planTier: 'starter',
      planName: 'Starter',
      endedAt: '2026-10-28T21:59:59.000Z',
      monthsPaid: 5,
      totalPaid: 225_000,
    },
    {
      userId: 'u-gone',
      operator: 'Port Sudan Hotspot',
      email: null,
      deleted: true,
      planTier: 'pro',
      planName: 'Pro',
      endedAt: '2026-09-14T21:59:59.000Z',
      monthsPaid: 2,
      totalPaid: 120_000,
    },
  ],
  paidNotActivated: [
    {
      userId: 'u-sennar',
      operator: 'Sennar Cafe',
      planName: 'Pro',
      amount: 90_000,
      approvedAt: '2026-11-08T09:15:00.000Z',
    },
  ],
};

const EMPTY_MONEY: MoneyAnalytics = {
  cards: {
    incomeThisMonth: 0,
    incomeSameDaysLastMonth: 0,
    changePct: null,
    payingOperators: 0,
    grantedOperators: 0,
    dueToRenew: { amount: 0, operators: 0, estimated: false },
    waiting: { count: 0, amount: 0, oldestSince: null },
  },
  income: { total: 0, fromDeletedOperators: 0 },
  incomeByMonth: [],
  incomeByPlan: [],
  renewalRate: [],
  renewalsDue: [],
  lost: [],
  paidNotActivated: [],
};

export function moneyFixture(overrides: Partial<MoneyAnalytics> = {}): MoneyAnalytics {
  return fresh(MONEY, overrides);
}

export function emptyMoneyFixture(overrides: Partial<MoneyAnalytics> = {}): MoneyAnalytics {
  return fresh(EMPTY_MONEY, overrides);
}

// --- operators --------------------------------------------------------------

const OPERATORS: OperatorsAnalytics = {
  // active = rows with cards used above zero
  cards: { active: 3, total: 5, quiet: 1, nearLimit: 1, notStarted: 1 },
  rows: [
    {
      userId: 'u-nile',
      operator: 'Cafe Nile',
      email: 'nile@example.com',
      planTier: 'pro',
      planName: 'Pro',
      daysLeft: 5,
      routersOnline: 2,
      routersTotal: 2,
      cardsCreated: 1_200,
      cardsUsed: 950,
      salesValue: 475_000,
      changePct: 18.4,
      lastActiveAt: '2026-11-15T09:40:00.000Z',
      flags: { isQuiet: false, nearLimit: false, notStarted: false },
    },
    {
      userId: 'u-atbara',
      operator: 'Atbara Net',
      email: 'atbara@example.com',
      planTier: 'starter',
      planName: 'Starter',
      daysLeft: 13,
      routersOnline: 1,
      routersTotal: 3,
      cardsCreated: 300,
      cardsUsed: 40,
      salesValue: 20_000,
      changePct: -62,
      lastActiveAt: '2026-11-02T16:05:00.000Z',
      flags: { isQuiet: true, nearLimit: false, notStarted: false },
    },
    {
      userId: 'u-kassala',
      operator: 'Kassala Wifi',
      email: 'kassala@example.com',
      planTier: 'enterprise',
      planName: 'Enterprise',
      daysLeft: 240,
      routersOnline: 4,
      routersTotal: 4,
      cardsCreated: 5_000,
      cardsUsed: 4_100,
      salesValue: 2_050_000,
      // The previous period predates the usage history.
      changePct: null,
      lastActiveAt: '2026-11-14T20:30:00.000Z',
      flags: { isQuiet: false, nearLimit: true, notStarted: false },
    },
    {
      // No subscription, no router, never logged in since launch.
      userId: 'u-newshop',
      operator: 'New Shop',
      email: 'newshop@example.com',
      planTier: null,
      planName: null,
      daysLeft: null,
      routersOnline: 0,
      routersTotal: 0,
      cardsCreated: 0,
      cardsUsed: 0,
      salesValue: 0,
      changePct: null,
      lastActiveAt: null,
      flags: { isQuiet: false, nearLimit: false, notStarted: true },
    },
    {
      // Tier with no plans row: the name falls back to the tier.
      userId: 'u-sennar',
      operator: 'Sennar Cafe',
      email: 'sennar@example.com',
      planTier: 'legacy',
      planName: 'legacy',
      daysLeft: 44,
      routersOnline: 0,
      routersTotal: 1,
      cardsCreated: 150,
      cardsUsed: 0,
      salesValue: 0,
      changePct: null,
      lastActiveAt: '2026-10-30T07:15:00.000Z',
      flags: { isQuiet: false, nearLimit: false, notStarted: false },
    },
  ],
};

const EMPTY_OPERATORS: OperatorsAnalytics = {
  cards: { active: 0, total: 0, quiet: 0, nearLimit: 0, notStarted: 0 },
  rows: [],
};

export function operatorsFixture(overrides: Partial<OperatorsAnalytics> = {}): OperatorsAnalytics {
  return fresh(OPERATORS, overrides);
}

export function emptyOperatorsFixture(
  overrides: Partial<OperatorsAnalytics> = {},
): OperatorsAnalytics {
  return fresh(EMPTY_OPERATORS, overrides);
}

// --- one operator (operator page section) -----------------------------------

const OPERATOR: OperatorAnalytics = {
  daily: [
    { day: '2026-11-13', cardsCreated: 40, cardsUsed: 31, salesValue: 15_500 },
    { day: '2026-11-14', cardsCreated: 0, cardsUsed: 28, salesValue: 14_000 },
    { day: '2026-11-15', cardsCreated: 60, cardsUsed: 12, salesValue: 6_000 },
  ],
  routers: [
    { routerId: 'r-3', uptimePct: 99.6, drops: 1, longestOutageSec: 360 },
    // Never seen online since recording began.
    { routerId: 'r-4', uptimePct: null, drops: 0, longestOutageSec: 0 },
  ],
  // newest first, every status
  payments: [
    {
      id: 'pay-3',
      planTier: 'pro',
      amount: 90_000,
      status: 'pending',
      createdAt: '2026-11-12T08:00:00.000Z',
      reviewedAt: null,
    },
    {
      id: 'pay-2',
      planTier: 'pro',
      amount: 90_000,
      status: 'approved',
      createdAt: '2026-10-10T08:00:00.000Z',
      reviewedAt: '2026-10-10T12:00:00.000Z',
    },
    {
      id: 'pay-1',
      planTier: 'starter',
      amount: 45_000,
      status: 'rejected',
      createdAt: '2026-09-02T08:00:00.000Z',
      reviewedAt: '2026-09-03T10:30:00.000Z',
    },
  ],
  // approved payments only
  totalPaid: 90_000,
};

const EMPTY_OPERATOR: OperatorAnalytics = { daily: [], routers: [], payments: [], totalPaid: 0 };

export function operatorFixture(overrides: Partial<OperatorAnalytics> = {}): OperatorAnalytics {
  return fresh(OPERATOR, overrides);
}

export function emptyOperatorFixture(overrides: Partial<OperatorAnalytics> = {}): OperatorAnalytics {
  return fresh(EMPTY_OPERATOR, overrides);
}

// --- network and cards ------------------------------------------------------

const NETWORK: NetworkAnalytics = {
  cards: {
    routersOnline: 2,
    routersTotal: 5,
    neverConnected: 1,
    notSeenSinceLaunch: 0,
    uptimePct: 89.8,
    dropping: 2,
    cardsUsed: 980,
    cardsCreated: 1_020,
    // 600 × 500 + 340 × 1,000; the 40 cards with no price add nothing.
    salesValue: 640_000,
    unpricedUsed: 40,
  },
  monitorStale: false,
  daily: [
    { day: '2026-11-13', cardsCreated: 420, cardsUsed: 380, dataBytes: 21 * GB },
    { day: '2026-11-14', cardsCreated: 0, cardsUsed: 410, dataBytes: 24 * GB },
    { day: '2026-11-15', cardsCreated: 600, cardsUsed: 190, dataBytes: 9 * GB },
  ],
  // dow 0 = Sunday … 6 = Saturday. Sparse on purpose: missing cells are zero.
  hours: [
    { dow: 5, hour: 20, sessions: 140 },
    { dow: 5, hour: 21, sessions: 180 },
    { dow: 6, hour: 21, sessions: 95 },
    { dow: 0, hour: 9, sessions: 12 },
  ],
  cardTypes: {
    byPrice: [
      { price: 500, cardsUsed: 600 },
      { price: 1_000, cardsUsed: 340 },
      { price: null, cardsUsed: 40 },
    ],
    byKind: [
      { limitType: 'time', cardsUsed: 700 },
      { limitType: 'data', cardsUsed: 240 },
      { limitType: null, cardsUsed: 40 },
    ],
  },
  // uptimePct ascending (nulls last), then drops descending
  routers: [
    {
      routerId: 'r-1',
      router: 'Souq Router',
      userId: 'u-atbara',
      operator: 'Atbara Net',
      uptimePct: 71.5,
      drops: 7,
      longestOutageSec: 32_400,
      sessions: 310,
      dataBytes: 12 * GB,
      status: 'online',
      flags: { dropping: true, offlineNow: false },
    },
    {
      routerId: 'r-2',
      router: 'Market AP',
      userId: 'u-atbara',
      operator: 'Atbara Net',
      uptimePct: 88,
      drops: 5,
      longestOutageSec: 5_400,
      sessions: 120,
      dataBytes: 4 * GB,
      status: 'offline',
      flags: { dropping: true, offlineNow: true },
    },
    {
      routerId: 'r-3',
      router: 'Cafe Nile Main',
      userId: 'u-nile',
      operator: 'Cafe Nile',
      uptimePct: 99.6,
      drops: 1,
      longestOutageSec: 360,
      sessions: 2_400,
      dataBytes: 38 * GB,
      status: 'online',
      flags: { dropping: false, offlineNow: false },
    },
    {
      routerId: 'r-4',
      router: 'Cafe Nile Roof',
      userId: 'u-nile',
      operator: 'Cafe Nile',
      uptimePct: 100,
      drops: 0,
      longestOutageSec: 0,
      sessions: 900,
      dataBytes: 9 * GB,
      status: 'degraded',
      flags: { dropping: false, offlineNow: false },
    },
    {
      // Never connected: nothing observed, so no uptime figure.
      routerId: 'r-5',
      router: 'New Shop Router',
      userId: 'u-newshop',
      operator: 'New Shop',
      uptimePct: null,
      drops: 0,
      longestOutageSec: 0,
      sessions: 0,
      dataBytes: 0,
      status: 'offline',
      flags: { dropping: false, offlineNow: true },
    },
  ],
};

const EMPTY_NETWORK: NetworkAnalytics = {
  cards: {
    routersOnline: 0,
    routersTotal: 0,
    neverConnected: 0,
    notSeenSinceLaunch: 0,
    uptimePct: null,
    dropping: 0,
    cardsUsed: 0,
    cardsCreated: 0,
    salesValue: 0,
    unpricedUsed: 0,
  },
  monitorStale: false,
  daily: [],
  hours: [],
  cardTypes: { byPrice: [], byKind: [] },
  routers: [],
};

export function networkFixture(overrides: Partial<NetworkAnalytics> = {}): NetworkAnalytics {
  return fresh(NETWORK, overrides);
}

export function emptyNetworkFixture(overrides: Partial<NetworkAnalytics> = {}): NetworkAnalytics {
  return fresh(EMPTY_NETWORK, overrides);
}

/**
 * The answer while the router monitor is silent, as the server sends it: no
 * online count, every router's status "unknown" and none flagged offline. The
 * history (uptime, drops, sessions, data) is the same as ever.
 */
export function staleNetworkFixture(overrides: Partial<NetworkAnalytics> = {}): NetworkAnalytics {
  const network = networkFixture();
  return {
    ...network,
    monitorStale: true,
    cards: { ...network.cards, routersOnline: 0 },
    routers: network.routers.map((router) => ({
      ...router,
      status: 'unknown' as const,
      flags: { ...router.flags, offlineNow: false },
    })),
    ...overrides,
  };
}

// --- API mock ---------------------------------------------------------------

/** What `api.get` resolves to: the axios response around the API envelope. */
export function analyticsResponse<T>(
  data: T,
  meta: AnalyticsMeta = metaFixture(),
): { data: { success: true; data: T; meta: AnalyticsMeta } } {
  return { data: { success: true, data, meta } };
}

export interface AnalyticsGetOverrides {
  money?: MoneyAnalytics;
  operators?: OperatorsAnalytics;
  operator?: OperatorAnalytics;
  network?: NetworkAnalytics;
  meta?: AnalyticsMeta;
}

/**
 * An implementation for a mocked `api.get` that answers the four analytics
 * endpoints with the fixtures above:
 *
 *   mockGet.mockImplementation(analyticsGet());
 *   mockGet.mockImplementation(analyticsGet({ money: emptyMoneyFixture(), meta: emptyMetaFixture() }));
 *
 * Any other path rejects, so a wrong URL shows up as an error state.
 */
export function analyticsGet(overrides: AnalyticsGetOverrides = {}) {
  return async (url: string): Promise<{ data: unknown }> => {
    const meta = overrides.meta ?? metaFixture();
    if (url === '/admin/analytics/money') {
      // Money is live: stamped with the request time and never stale.
      return analyticsResponse(
        overrides.money ?? moneyFixture(),
        overrides.meta ?? metaFixture({ refreshedAt: new Date().toISOString(), stale: false }),
      );
    }
    if (url === '/admin/analytics/operators') {
      return analyticsResponse(overrides.operators ?? operatorsFixture(), meta);
    }
    if (url === '/admin/analytics/network') {
      return analyticsResponse(overrides.network ?? networkFixture(), meta);
    }
    if (url.startsWith('/admin/analytics/operators/')) {
      return analyticsResponse(overrides.operator ?? operatorFixture(), meta);
    }
    throw new Error(`analyticsGet: no fixture for ${url}`);
  };
}
