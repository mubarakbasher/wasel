import { useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  analyticsKey,
  fetchOperator,
  type AnalyticsMeta,
  type OperatorAnalytics,
} from '../../lib/analytics';
import { formatDateTime, formatDay } from '../../lib/datetime';
import { apiErrorMessage, formatCompact, formatNumber, formatSdg } from '../../lib/format';
import { MAX_RANGE_DAYS, isDay, rangeDays, type PeriodQuery } from '../../lib/period';
import BarChart from '../charts/BarChart';
import LineChart from '../charts/LineChart';
import { SERIES_BLUE, SERIES_VIOLET, type Series } from '../charts/chartCore';
import ErrorPanel from '../ErrorPanel';
import StatusBadge from '../StatusBadge';
import PeriodPicker from './PeriodPicker';
import RefreshedStamp from './RefreshedStamp';

// The look of the cards on the operator page this section sits in.
const CARD = 'bg-white rounded-xl border border-slate-200 p-6';
const CARD_TITLE = 'text-lg font-semibold text-slate-900';
const CHART_TITLE = 'text-sm font-semibold text-slate-900';

/** Both chart blocks are this tall, drawn or empty, so nothing jumps between periods. */
const CHART_HEIGHT = 220;

const DAY_MS = 86_400_000;

type Daily = OperatorAnalytics['daily'][number];

// Created and used share one axis: both count cards. The second line is dashed,
// so the two are told apart by more than colour.
const CARD_SERIES: Series[] = [
  { key: 'created', label: 'Created', colorClass: SERIES_BLUE },
  { key: 'used', label: 'Used', colorClass: SERIES_VIOLET, dashed: true },
];

const SALES_SERIES: Series[] = [{ key: 'sales', label: 'Sales value', colorClass: SERIES_BLUE }];

/** "2026-10-20" → "20 Oct 2026". */
function dayWithYear(day: string): string {
  return `${formatDay(day)} ${day.slice(0, 4)}`;
}

/** "pro" → "Pro": payments carry the tier key, not a plan name. */
function tierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/**
 * One row for every day of the period. A day the answer leaves out had no
 * cards, so it is a zero: without it the charts would close the gap and draw
 * two distant days side by side. With no rows at all there is nothing to draw,
 * and a range that cannot be read is left as it came.
 */
function everyDay(daily: Daily[], range: { from: string; to: string }): Daily[] {
  if (daily.length === 0) return [];
  if (!isDay(range.from) || !isDay(range.to) || range.from > range.to) return daily;
  const days = rangeDays(range.from, range.to);
  if (days > MAX_RANGE_DAYS) return daily;

  const byDay = new Map(daily.map((row) => [row.day, row]));
  const first = Date.parse(`${range.from}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(first + i * DAY_MS).toISOString().slice(0, 10);
    return byDay.get(day) ?? { day, cardsCreated: 0, cardsUsed: 0, salesValue: 0 };
  });
}

// --- charts -----------------------------------------------------------------

function ChartBlock({
  title,
  aside,
  caption,
  children,
}: {
  title: string;
  /** Sits opposite the title: the totals of the period. */
  aside?: ReactNode;
  /** A line under the chart for what the drawing cannot say itself. */
  caption?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h4 className={CHART_TITLE}>{title}</h4>
        {aside && <p className="text-xs text-slate-500">{aside}</p>}
      </div>
      {children}
      {caption && <p className="mt-3 text-xs text-slate-500">{caption}</p>}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <>
      {label} <span className="font-semibold text-slate-900">{value}</span>
    </>
  );
}

function OperatorCharts({
  daily,
  meta,
  busy,
}: {
  daily: Daily[];
  meta: AnalyticsMeta;
  /** Another period is loading: these are still the figures of the last one. */
  busy: boolean;
}) {
  const days = everyDay(daily, meta.range);
  const created = days.reduce((sum, day) => sum + day.cardsCreated, 0);
  const used = days.reduce((sum, day) => sum + day.cardsUsed, 0);
  const sales = days.reduce((sum, day) => sum + day.salesValue, 0);
  // A period of zeros is nothing to draw: show the empty block, not a flat line.
  const hasCards = days.some((day) => day.cardsCreated > 0 || day.cardsUsed > 0);
  const hasSales = days.some((day) => day.salesValue > 0);
  const historyStart = meta.usageHistoryStart;

  return (
    <div
      aria-busy={busy}
      className={`space-y-8 transition-opacity duration-200 ${busy ? 'opacity-60' : ''}`}
    >
      {meta.range.from < historyStart && (
        <p className="text-xs text-slate-500">
          {`Use history begins on ${dayWithYear(historyStart)}: cards used and sales value are empty before that day.`}
        </p>
      )}

      <ChartBlock
        title="Cards created and used per day"
        aside={
          hasCards && (
            <>
              <Figure label="Created" value={formatNumber(created)} />
              {' · '}
              <Figure label="Used" value={formatNumber(used)} />
            </>
          )
        }
      >
        <LineChart
          ariaLabel="Cards created and used per day"
          height={CHART_HEIGHT}
          points={
            hasCards
              ? days.map((day) => ({
                  label: formatDay(day.day),
                  values: {
                    created: day.cardsCreated,
                    // Before the use history there is no figure, which is not a zero.
                    used: day.day < historyStart ? null : day.cardsUsed,
                  },
                }))
              : []
          }
          series={CARD_SERIES}
          valueFormat={formatNumber}
          emptyMessage="No cards created or used in this period"
        />
      </ChartBlock>

      <ChartBlock
        title="Sales value per day"
        aside={hasSales && <Figure label="Total" value={formatSdg(sales)} />}
        caption="Operator's own sales, not Wasel income"
      >
        <BarChart
          ariaLabel="Sales value per day"
          height={CHART_HEIGHT}
          data={
            hasSales
              ? days.map((day) => ({ label: formatDay(day.day), values: { sales: day.salesValue } }))
              : []
          }
          series={SALES_SERIES}
          valueFormat={formatSdg}
          axisFormat={formatCompact}
          emptyMessage="No card sales in this period"
        />
      </ChartBlock>
    </div>
  );
}

function ChartsSkeleton() {
  return (
    <div role="status" aria-label="Loading operator figures" className="animate-pulse space-y-8">
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i}>
          <div className="mb-3 h-4 w-48 rounded bg-slate-200" />
          <div className="rounded-lg bg-slate-100" style={{ height: CHART_HEIGHT }} />
        </div>
      ))}
    </div>
  );
}

// --- payments ---------------------------------------------------------------

const TH = 'px-4 py-2.5';
const TD = 'px-4 py-2.5';

/** Every payment of the operator, whatever its status, and what was approved in all. */
function OperatorPayments({
  payments,
  totalPaid,
}: {
  payments: OperatorAnalytics['payments'];
  totalPaid: number;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={CARD}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 id={headingId} className={CARD_TITLE}>
          Payments
        </h3>
        <p className="text-sm text-slate-600" title="The sum of this operator's approved payments">
          <span>Total paid</span>{' '}
          <span className="font-semibold text-slate-900">{formatSdg(totalPaid)}</span>
        </p>
      </div>
      {payments.length === 0 ? (
        <p className="text-sm text-slate-500">No payments yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table aria-labelledby={headingId} className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className={TH}>
                  Date
                </th>
                <th scope="col" className={TH}>
                  Plan
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Amount
                </th>
                <th scope="col" className={TH}>
                  Status
                </th>
                <th scope="col" className={TH}>
                  Reviewed
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td className={`${TD} whitespace-nowrap text-slate-600`}>
                    {formatDateTime(payment.createdAt)}
                  </td>
                  <td className={`${TD} text-slate-900`}>{tierLabel(payment.planTier)}</td>
                  <td className={`${TD} whitespace-nowrap text-right font-medium tabular-nums text-slate-900`}>
                    {formatSdg(payment.amount)}
                  </td>
                  <td className={TD}>
                    <StatusBadge status={payment.status} />
                  </td>
                  <td className={`${TD} whitespace-nowrap text-slate-600`}>
                    {formatDateTime(payment.reviewedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// --- section ----------------------------------------------------------------

/**
 * The analytics of one operator, for their page: cards created and used per
 * day, the value of the cards they sold, and their payments.
 *
 * It has its own request and its own period picker (30 days to start with), so
 * nothing else on the page waits for it, and a failure here shows here only.
 * The picker scopes the two charts; the payments are the operator's whole
 * history. While another period loads the charts on screen stay, dimmed.
 */
export default function OperatorAnalyticsSection({ userId }: { userId: string }) {
  const headingId = useId();
  const [period, setPeriod] = useState<PeriodQuery>({ period: '30d' });

  const query = useQuery({
    // The operator id goes last: `placeholderData` reads it from there. The
    // operator page asks for the same key, so the two share one request.
    queryKey: [...analyticsKey('operator', period), userId],
    queryFn: () => fetchOperator(userId, period),
    // Hold the last answer through a period change, but never show one
    // operator's figures under another.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey.at(-1) === userId ? previous : undefined,
  });

  const result = query.isError ? undefined : query.data;

  return (
    <div className="space-y-6">
      <section aria-labelledby={headingId} className={CARD}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h3 id={headingId} className={CARD_TITLE}>
              Cards and sales
            </h3>
            {result && <RefreshedStamp refreshedAt={result.meta.refreshedAt} stale={result.meta.stale} />}
          </div>
          <PeriodPicker tab="operators" value={period} onChange={setPeriod} className="sm:items-end" />
        </div>

        {query.isError ? (
          <ErrorPanel message={apiErrorMessage(query.error)} onRetry={() => query.refetch()} />
        ) : result ? (
          <OperatorCharts
            daily={result.data.daily}
            meta={result.meta}
            busy={query.isPlaceholderData}
          />
        ) : (
          <ChartsSkeleton />
        )}
      </section>

      {result && (
        <OperatorPayments payments={result.data.payments} totalPaid={result.data.totalPaid} />
      )}
    </div>
  );
}
