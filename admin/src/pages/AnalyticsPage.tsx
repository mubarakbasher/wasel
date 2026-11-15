import { useMemo } from 'react';
import { NavLink, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import type { AnalyticsTab } from '../lib/analytics';
import { PRESETS, parsePeriod, periodToParams, type PeriodQuery } from '../lib/period';
import PeriodPicker from '../components/analytics/PeriodPicker';
import MoneyTab from '../components/analytics/MoneyTab';
import OperatorsTab from '../components/analytics/OperatorsTab';
import NetworkTab from '../components/analytics/NetworkTab';

const TABS: { key: AnalyticsTab; label: string }[] = [
  { key: 'money', label: 'Money' },
  { key: 'operators', label: 'Operators' },
  { key: 'network', label: 'Network and cards' },
];

function isAnalyticsTab(value: string | undefined): value is AnalyticsTab {
  return TABS.some((t) => t.key === value);
}

/**
 * The query string a tab link carries. Only the period travels between tabs:
 * a custom range always, a preset when it was chosen and the target tab offers
 * it too. Search, filter and sort belong to one tab's table and are dropped.
 */
function tabSearch(params: URLSearchParams, current: AnalyticsTab, target: AnalyticsTab): string {
  const period = parsePeriod(params, current);
  const next = new URLSearchParams();
  if ('from' in period) {
    next.set('from', period.from);
    next.set('to', period.to);
  } else if (
    params.get('period') === period.period &&
    PRESETS[target].some((p) => p.key === period.period)
  ) {
    next.set('period', period.period);
  }
  const text = next.toString();
  return text ? `?${text}` : '';
}

/**
 * The Analytics section: three tabs under /analytics/:tab and one period
 * picker. The period lives in the query string, so a view can be linked,
 * reloaded and carried from tab to tab. Each tab gets the parsed `period` and
 * makes its own single request with it.
 */
export default function AnalyticsPage() {
  const { tab: tabParam } = useParams();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = isAnalyticsTab(tabParam) ? tabParam : null;
  const period = useMemo(() => parsePeriod(searchParams, tab ?? 'money'), [searchParams, tab]);

  // /analytics and any unknown tab land on Money, keeping the query string.
  if (tab === null) {
    return <Navigate to={{ pathname: '/analytics/money', search: location.search }} replace />;
  }

  const setPeriod = (next: PeriodQuery) => {
    setSearchParams(
      (prev) => {
        // Replace the period only: the tab's own search, filter and sort stay.
        const params = new URLSearchParams(prev);
        params.delete('period');
        params.delete('from');
        params.delete('to');
        for (const [key, value] of Object.entries(periodToParams(next))) params.set(key, value);
        return params;
      },
      { replace: true },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
        <PeriodPicker tab={tab} value={period} onChange={setPeriod} className="sm:items-end" />
      </div>

      {/* The rule belongs to the wrapper and the nav sits 1px over it, so the
          active tab's underline covers the rule without overflowing a
          scrollable box (which would grow a vertical scrollbar). */}
      <div className="border-b border-slate-200">
        <nav aria-label="Analytics sections" className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <NavLink
              key={t.key}
              to={{ pathname: `/analytics/${t.key}`, search: tabSearch(searchParams, tab, t.key) }}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {tab === 'money' && <MoneyTab period={period} />}
      {tab === 'operators' && <OperatorsTab period={period} />}
      {tab === 'network' && <NetworkTab period={period} />}
    </div>
  );
}
