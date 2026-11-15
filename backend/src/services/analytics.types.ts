export type PeriodPreset = 'month' | '30d' | '3m' | '12m';
export type AnalyticsTab = 'money' | 'operators' | 'network';

export interface AnalyticsMeta {
  timezone: string;
  period: PeriodPreset | 'custom';
  range: { from: string; to: string };
  previous: { from: string; to: string };
  refreshedAt: string | null;
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
  incomeByMonth: { month: string; new: number; renewal: number; planChange: number }[];
  incomeByPlan: { planTier: string; planName: string; amount: number; sharePct: number | null }[];
  renewalRate: { month: string; ended: number; renewed: number; ratePct: number | null; provisional: boolean }[];
  renewalsDue: RenewalDueRow[];
  lost: LostOperatorRow[];
  paidNotActivated: { userId: string; operator: string; planName: string; amount: number; approvedAt: string }[];
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
  payments: { id: string; planTier: string; amount: number; status: string; createdAt: string; reviewedAt: string | null }[];
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
  monitorStale: boolean;
  daily: { day: string; cardsCreated: number; cardsUsed: number; dataBytes: number }[];
  hours: { dow: number; hour: number; sessions: number }[];
  cardTypes: {
    byPrice: { price: number | null; cardsUsed: number }[];
    byKind: { limitType: string | null; cardsUsed: number }[];
  };
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

export interface ResolvedPeriod {
  period: PeriodPreset | 'custom';
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  days: number;
}
