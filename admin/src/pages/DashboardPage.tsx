import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Users,
  DollarSign,
  CreditCard,
  Ticket,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
} from 'lucide-react';
import api from '../lib/api';
import StatCard from '../components/StatCard';
import ErrorPanel from '../components/ErrorPanel';
import DonutChart, { type DonutSegment } from '../components/charts/DonutChart';
import TrendChart, { type TrendPoint } from '../components/charts/TrendChart';

const TREND_DAYS = 30;

interface Stats {
  totalUsers: number;
  subscriptionsByStatus: Record<string, number>;
  pendingPayments: number;
  totalRevenue: number;
  routersByStatus: Record<string, number>;
  totalVouchers: number;
}

interface TimeseriesPoint {
  date: string;
  revenue: number;
  newUsers: number;
  vouchers: number;
  activeSubscriptions: number | null;
  routersOnline: number | null;
}

interface Timeseries {
  days: number;
  series: TimeseriesPoint[];
}

type Metric = 'revenue' | 'users' | 'vouchers';

const METRICS: { key: Metric; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'users', label: 'Users' },
  { key: 'vouchers', label: 'Vouchers' },
];

/** Map a subscription/router status to a semantic Tailwind text color. */
function statusColor(status: string): string {
  switch (status) {
    case 'active':
    case 'online':
      return 'text-green-500';
    case 'pending':
    case 'pending_change':
    case 'degraded':
      return 'text-amber-500';
    case 'expired':
    case 'offline':
      return 'text-red-500';
    case 'cancelled':
      return 'text-slate-400';
    default:
      return 'text-blue-500';
  }
}

/** Build donut segments from a status→count record, in a stable, readable order. */
function buildSegments(
  record: Record<string, number> | undefined,
  order: string[],
): DonutSegment[] {
  const rec = record ?? {};
  const known = order.filter((k) => k in rec);
  const extra = Object.keys(rec).filter((k) => !order.includes(k));
  return [...known, ...extra].map((key) => ({
    label: key.replace(/_/g, ' '),
    value: rec[key] ?? 0,
    colorClass: statusColor(key),
  }));
}

/** "Updated 2m ago" style relative label. */
function formatRelative(ts: number, now: number): string {
  if (!ts) return '';
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function CardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-6 animate-pulse ${className}`}
    >
      <div className="h-4 w-28 rounded bg-slate-200" />
      <div className="mt-4 h-32 rounded bg-slate-100" />
    </div>
  );
}

export default function DashboardPage() {
  const [metric, setMetric] = useState<Metric>('revenue');

  // Tick so the "Updated Xm ago" label stays fresh between refetches.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const statsQuery = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const { data: res } = await api.get('/admin/stats');
      return res.data as Stats;
    },
    refetchInterval: 60_000,
  });

  const tsQuery = useQuery({
    queryKey: ['admin', 'stats', 'timeseries', TREND_DAYS],
    queryFn: async () => {
      const { data: res } = await api.get('/admin/stats/timeseries', {
        params: { days: TREND_DAYS },
      });
      return res.data as Timeseries;
    },
  });

  const stats = statsQuery.data;

  if (statsQuery.isError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold text-slate-900">Dashboard</h1>
        <ErrorPanel
          message={
            statsQuery.error instanceof Error
              ? statsQuery.error.message
              : undefined
          }
          onRetry={() => statsQuery.refetch()}
        />
      </div>
    );
  }

  const updated = statsQuery.dataUpdatedAt
    ? formatRelative(statsQuery.dataUpdatedAt, now)
    : '';

  // --- Needs-attention computation ---
  const pendingPayments = stats?.pendingPayments ?? 0;
  const routersOffline = stats?.routersByStatus?.offline ?? 0;
  const routersDegraded = stats?.routersByStatus?.degraded ?? 0;
  const routersAttention = routersOffline + routersDegraded;
  const needsAttention = pendingPayments > 0 || routersAttention > 0;

  // --- Trend series ---
  const series = tsQuery.data?.series ?? [];
  let trendPoints: TrendPoint[] = [];
  let valueFormat: (n: number) => string = (n) => n.toLocaleString();
  let trendColor = 'text-emerald-500';
  if (metric === 'revenue') {
    trendPoints = series.map((p) => ({ date: p.date, value: p.revenue }));
    valueFormat = (n) => `SDG ${n.toLocaleString()}`;
    trendColor = 'text-emerald-500';
  } else if (metric === 'users') {
    // Total-users trajectory: start from the user count that existed BEFORE the
    // window (totalUsers minus sign-ups within it) and accumulate, so the line
    // ends exactly on the Total Users KPI rather than at the 30-day delta.
    const windowNewUsers = series.reduce((sum, p) => sum + p.newUsers, 0);
    let running = Math.max(0, (stats?.totalUsers ?? 0) - windowNewUsers);
    trendPoints = series.map((p) => {
      running += p.newUsers;
      return { date: p.date, value: running };
    });
    valueFormat = (n) => n.toLocaleString();
    trendColor = 'text-blue-500';
  } else {
    trendPoints = series.map((p) => ({ date: p.date, value: p.vouchers }));
    valueFormat = (n) => n.toLocaleString();
    trendColor = 'text-violet-500';
  }
  const metricLabel = METRICS.find((m) => m.key === metric)?.label ?? '';

  // --- Loading skeleton ---
  if (statsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-6 animate-pulse"
            >
              <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-200" />
              <div className="min-w-0 flex-1">
                <div className="h-3 w-20 rounded bg-slate-200" />
                <div className="mt-3 h-6 w-14 rounded bg-slate-200" />
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <CardSkeleton />
      </div>
    );
  }

  const kpis = [
    {
      title: 'Total Users',
      value: (stats?.totalUsers ?? 0).toLocaleString(),
      icon: <Users className="h-6 w-6" />,
      color: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Total Revenue',
      value: `SDG ${(stats?.totalRevenue ?? 0).toLocaleString()}`,
      icon: <DollarSign className="h-6 w-6" />,
      color: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: 'Active Subscriptions',
      value: (stats?.subscriptionsByStatus?.active ?? 0).toLocaleString(),
      icon: <CreditCard className="h-6 w-6" />,
      color: 'bg-green-50 text-green-600',
    },
    {
      title: 'Total Vouchers',
      value: (stats?.totalVouchers ?? 0).toLocaleString(),
      icon: <Ticket className="h-6 w-6" />,
      color: 'bg-violet-50 text-violet-600',
    },
  ];

  const subscriptionSegments = buildSegments(stats?.subscriptionsByStatus, [
    'active',
    'pending',
    'pending_change',
    'expired',
    'cancelled',
  ]);
  const routerSegments = buildSegments(stats?.routersByStatus, [
    'online',
    'degraded',
    'offline',
  ]);

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        {updated && (
          <p className="text-xs text-slate-400">
            Updated{' '}
            <span className="font-medium text-slate-500">{updated}</span>
          </p>
        )}
      </div>

      {/* 2. KPI hero */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <StatCard
            key={kpi.title}
            title={kpi.title}
            value={kpi.value}
            icon={kpi.icon}
            color={kpi.color}
          />
        ))}
      </div>

      {/* 3. Needs attention */}
      {needsAttention ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <h2 className="text-sm font-semibold text-amber-900">
              Needs attention
            </h2>
          </div>
          <ul className="space-y-2">
            {pendingPayments > 0 && (
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-amber-900">
                  <span className="font-semibold tabular-nums">
                    {pendingPayments.toLocaleString()}
                  </span>{' '}
                  pending payment{pendingPayments === 1 ? '' : 's'}
                </span>
                <Link
                  to="/payments"
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                >
                  Review
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </li>
            )}
            {routersAttention > 0 && (
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-amber-900">
                  <span className="font-semibold tabular-nums">
                    {routersAttention.toLocaleString()}
                  </span>{' '}
                  router{routersAttention === 1 ? '' : 's'} need attention
                  <span className="text-amber-700">
                    {' '}
                    ({routersOffline} offline, {routersDegraded} degraded)
                  </span>
                </span>
                <Link
                  to="/routers"
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                >
                  View
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </li>
            )}
          </ul>
        </section>
      ) : (
        <section className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-5">
          <CheckCircle className="h-5 w-5 shrink-0 text-green-600" />
          <p className="text-sm font-medium text-green-800">
            All clear — nothing needs attention
          </p>
        </section>
      )}

      {/* 4. Status breakdowns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">
            Subscriptions
          </h2>
          <DonutChart segments={subscriptionSegments} />
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Routers</h2>
          <DonutChart segments={routerSegments} />
        </section>
      </div>

      {/* 5. Trends */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">
            {metricLabel}
            <span className="font-normal text-slate-400">
              {' '}
              · last {TREND_DAYS} days
            </span>
          </h2>
          <div
            role="group"
            aria-label="Select trend metric"
            className="inline-flex gap-1 rounded-lg bg-slate-100 p-1"
          >
            {METRICS.map((m) => {
              const active = m.key === metric;
              return (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setMetric(m.key)}
                  className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {tsQuery.isError ? (
          <ErrorPanel
            message={
              tsQuery.error instanceof Error ? tsQuery.error.message : undefined
            }
            onRetry={() => tsQuery.refetch()}
          />
        ) : tsQuery.isLoading ? (
          <div className="h-[180px] animate-pulse rounded-lg bg-slate-100" />
        ) : (
          <TrendChart
            points={trendPoints}
            colorClass={trendColor}
            valueFormat={valueFormat}
          />
        )}
      </section>
    </div>
  );
}
