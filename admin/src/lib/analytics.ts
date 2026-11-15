/**
 * The Analytics API: the response shapes and one fetch function per endpoint.
 *
 * The types mirror `backend/src/services/analytics.types.ts` field for field.
 * Days are 'YYYY-MM-DD' and months 'YYYY-MM' as plain text (Khartoum
 * calendar); format them with `formatDay` / `formatMonth`, never through a
 * local-time Date. Every percentage is null when it has nothing to divide by.
 */
import api from './api';
import { periodKey, periodToParams, type PeriodQuery } from './period';

export type PeriodPreset = 'month' | '30d' | '3m' | '12m';
export type AnalyticsTab = 'money' | 'operators' | 'network';

export interface AnalyticsMeta {
  timezone: string;
  period: PeriodPreset | 'custom';
  /** Inclusive days, 'YYYY-MM-DD'. */
  range: { from: string; to: string };
  previous: { from: string; to: string };
  /** ISO time of the last summary run; for money, the request time. */
  refreshedAt: string | null;
  /** True when refreshedAt is null or older than 270 minutes; always false for money. */
  stale: boolean;
  usageHistoryStart: string;
  routerHistoryStart: string | null;
  cardHistoryComplete: boolean;
}

export interface MoneyAnalytics {
  cards: {
    incomeThisMonth: number;
    incomeSameDaysLastMonth: number;
    changePct: number | null;
    payingOperators: number;
    grantedOperators: number;
    dueToRenew: { amount: number; operators: number; estimated: boolean };
    waiting: { count: number; amount: number; oldestSince: string | null };
  };
  income: { total: number; fromDeletedOperators: number };
  /** month is 'YYYY-MM'. */
  incomeByMonth: { month: string; new: number; renewal: number; planChange: number }[];
  incomeByPlan: { planTier: string; planName: string; amount: number; sharePct: number | null }[];
  renewalRate: {
    month: string;
    ended: number;
    renewed: number;
    ratePct: number | null;
    provisional: boolean;
  }[];
  /** endsAt ascending. */
  renewalsDue: RenewalDueRow[];
  /** endedAt descending. */
  lost: LostOperatorRow[];
  paidNotActivated: {
    userId: string;
    operator: string;
    planName: string;
    amount: number;
    approvedAt: string;
  }[];
}

export interface RenewalDueRow {
  userId: string;
  operator: string;
  email: string | null;
  planTier: string;
  planName: string;
  endsAt: string;
  amount: number | null;
  estimated: boolean;
  granted: boolean;
  /** How many of the operator's payments were approved before: a count, not an amount. */
  paidBefore: number;
}

export interface LostOperatorRow {
  userId: string;
  operator: string;
  email: string | null;
  deleted: boolean;
  planTier: string;
  planName: string;
  endedAt: string;
  monthsPaid: number;
  totalPaid: number;
}

export interface OperatorsAnalytics {
  cards: { active: number; total: number; quiet: number; nearLimit: number; notStarted: number };
  rows: OperatorRow[];
}

export interface OperatorRow {
  userId: string;
  operator: string;
  email: string;
  planTier: string | null;
  planName: string | null;
  daysLeft: number | null;
  routersOnline: number;
  routersTotal: number;
  cardsCreated: number;
  cardsUsed: number;
  salesValue: number;
  changePct: number | null;
  lastActiveAt: string | null;
  flags: { isQuiet: boolean; nearLimit: boolean; notStarted: boolean };
}

export interface OperatorAnalytics {
  daily: { day: string; cardsCreated: number; cardsUsed: number; salesValue: number }[];
  routers: { routerId: string; uptimePct: number | null; drops: number; longestOutageSec: number }[];
  payments: {
    id: string;
    planTier: string;
    amount: number;
    status: string;
    createdAt: string;
    reviewedAt: string | null;
  }[];
  totalPaid: number;
}

export interface NetworkAnalytics {
  cards: {
    routersOnline: number;
    routersTotal: number;
    neverConnected: number;
    notSeenSinceLaunch: number;
    uptimePct: number | null;
    dropping: number;
    cardsUsed: number;
    cardsCreated: number;
    salesValue: number;
    unpricedUsed: number;
  };
  /** The router monitor has not reported for over 3 minutes: live status is unknown. */
  monitorStale: boolean;
  daily: { day: string; cardsCreated: number; cardsUsed: number; dataBytes: number }[];
  /** dow 0 = Sunday … 6 = Saturday, hour 0–23. Cells with no sessions may be absent. */
  hours: { dow: number; hour: number; sessions: number }[];
  cardTypes: {
    byPrice: { price: number | null; cardsUsed: number }[];
    byKind: { limitType: string | null; cardsUsed: number }[];
  };
  /** uptimePct ascending (nulls last), then drops descending. */
  routers: RouterRow[];
}

export interface RouterRow {
  routerId: string;
  router: string;
  userId: string;
  operator: string;
  uptimePct: number | null;
  drops: number;
  longestOutageSec: number;
  sessions: number;
  dataBytes: number;
  status: 'online' | 'offline' | 'degraded' | 'unknown';
  flags: { dropping: boolean; offlineNow: boolean };
}

/** What every fetch below resolves to: the envelope's `data` and `meta`. */
export interface AnalyticsResult<T> {
  data: T;
  meta: AnalyticsMeta;
}

async function getAnalytics<T>(path: string, p: PeriodQuery): Promise<AnalyticsResult<T>> {
  const { data: res } = await api.get(path, { params: periodToParams(p) });
  return { data: res.data as T, meta: res.meta as AnalyticsMeta };
}

export function fetchMoney(p: PeriodQuery): Promise<AnalyticsResult<MoneyAnalytics>> {
  return getAnalytics<MoneyAnalytics>('/admin/analytics/money', p);
}

export function fetchOperators(p: PeriodQuery): Promise<AnalyticsResult<OperatorsAnalytics>> {
  return getAnalytics<OperatorsAnalytics>('/admin/analytics/operators', p);
}

export function fetchNetwork(p: PeriodQuery): Promise<AnalyticsResult<NetworkAnalytics>> {
  return getAnalytics<NetworkAnalytics>('/admin/analytics/network', p);
}

export function fetchOperator(
  id: string,
  p: PeriodQuery,
): Promise<AnalyticsResult<OperatorAnalytics>> {
  return getAnalytics<OperatorAnalytics>(`/admin/analytics/operators/${encodeURIComponent(id)}`, p);
}

/**
 * Query key of one analytics request. Everything analytics sits under
 * ['admin', 'analytics'], and one tab under ['admin', 'analytics', tab], so
 * either prefix can be invalidated.
 */
export function analyticsKey(tab: string, p: PeriodQuery): unknown[] {
  return ['admin', 'analytics', tab, periodKey(p)];
}
