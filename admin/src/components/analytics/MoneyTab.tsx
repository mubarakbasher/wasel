import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, CalendarClock, Hourglass, Users } from 'lucide-react';
import {
  analyticsKey,
  fetchMoney,
  type AnalyticsMeta,
  type LostOperatorRow,
  type MoneyAnalytics,
  type RenewalDueRow,
} from '../../lib/analytics';
import { formatDate, formatDateTime, formatDay, formatMonth } from '../../lib/datetime';
import {
  apiErrorMessage,
  changeSign,
  formatChange,
  formatCompact,
  formatNumber,
  formatPercent,
  formatRelative,
  formatSdg,
} from '../../lib/format';
import { periodKey, periodToParams, type PeriodQuery } from '../../lib/period';
import BarChart from '../charts/BarChart';
import ShareBars from '../charts/ShareBars';
import { SERIES_BLUE, SERIES_SLATE, SERIES_VIOLET, type Series } from '../charts/chartCore';
import DataTable, { type Column } from '../DataTable';
import ErrorPanel from '../ErrorPanel';
import ExportCsvButton from '../ExportCsvButton';
import StatCard, { type StatCardDelta } from '../StatCard';
import RefreshedStamp from './RefreshedStamp';

const CARD = 'rounded-xl border border-slate-200 bg-white p-6';
const CARD_TITLE = 'text-sm font-semibold text-slate-900';
const TEXT_LINK =
  'rounded-sm font-medium text-blue-600 hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const TAG =
  'inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/20';

/** Every chart block is this tall, drawn or empty, so nothing jumps between periods. */
const CHART_HEIGHT = 240;
/** Rows of a table shown at once; the rest are a page away. */
const PAGE_SIZE = 20;

const INCOME_SERIES: Series[] = [
  { key: 'new', label: 'New', colorClass: SERIES_BLUE },
  { key: 'renewal', label: 'Renewal', colorClass: SERIES_VIOLET },
  { key: 'planChange', label: 'Plan change', colorClass: SERIES_SLATE },
];

const RATE_SERIES: Series[] = [{ key: 'rate', label: 'Renewal rate', colorClass: SERIES_BLUE }];

/** How often an operator has paid before: "Never", "Once", "3 times". */
function paidBeforeLabel(count: number): string {
  if (!Number.isFinite(count)) return '—';
  if (count <= 0) return 'Never';
  if (count === 1) return 'Once';
  return `${formatNumber(count)} times`;
}

/** "1 Sept – 15 Nov 2026". Both years are printed when the range crosses one. */
function rangeLabel({ from, to }: { from: string; to: string }): string {
  const fromYear = from.slice(0, 4);
  const toYear = to.slice(0, 4);
  if (from === to) return `${formatDay(to)} ${toYear}`;
  if (fromYear === toYear) return `${formatDay(from)} – ${formatDay(to)} ${toYear}`;
  return `${formatDay(from)} ${fromYear} – ${formatDay(to)} ${toYear}`;
}

/** "Africa/Khartoum" → "Khartoum": the place whose calendar the days follow. */
function zoneName(timezone: string): string {
  return (timezone.split('/').pop() || timezone).replace(/_/g, ' ');
}

/** The plan names to print. Two tiers that share a name get their tier key added. */
function planLabels(plans: MoneyAnalytics['incomeByPlan']): string[] {
  const nameKey = (name: string) => name.trim().toLowerCase();
  const uses = new Map<string, number>();
  for (const plan of plans) {
    uses.set(nameKey(plan.planName), (uses.get(nameKey(plan.planName)) ?? 0) + 1);
  }
  return plans.map((plan) =>
    (uses.get(nameKey(plan.planName)) ?? 0) > 1
      ? `${plan.planName} (${plan.planTier})`
      : plan.planName,
  );
}

function incomeDelta(changePct: number | null): StatCardDelta | undefined {
  // The arrow follows the printed figure: +0.2% reads "0%" and is flat.
  const sign = changeSign(changePct);
  if (sign === null) return undefined;
  return {
    text: formatChange(changePct),
    direction: sign > 0 ? 'up' : sign < 0 ? 'down' : 'flat',
    good: sign >= 0,
  };
}

// --- cards ------------------------------------------------------------------

/**
 * The four figures of the tab. They keep their own meaning (this month, now,
 * the next 30 days) and do not follow the period picker.
 */
function MoneyCards({ cards, meta }: { cards: MoneyAnalytics['cards']; meta: AnalyticsMeta }) {
  const delta = incomeDelta(cards.changePct);
  const { dueToRenew, waiting } = cards;

  // The age of the oldest waiting payment at the moment the server answered,
  // so the reader's own clock cannot skew it.
  const asOf = meta.refreshedAt ? Date.parse(meta.refreshedAt) : NaN;
  const since = waiting.oldestSince ? Date.parse(waiting.oldestSince) : NaN;
  const oldest = Number.isFinite(asOf) && Number.isFinite(since) ? formatRelative(since, asOf) : '';

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
      <StatCard
        title="Income this month"
        value={formatSdg(cards.incomeThisMonth)}
        icon={<Banknote className="h-6 w-6" aria-hidden="true" />}
        color="bg-emerald-50 text-emerald-600"
        delta={delta}
        sub={
          <span title={`Same days last month: ${formatSdg(cards.incomeSameDaysLastMonth)}`}>
            {/* With nothing to compare with there is no percentage, only a dash. */}
            {!delta && <span className="font-semibold">—</span>} vs same days last month
          </span>
        }
      />
      <StatCard
        title="Paying operators"
        value={formatNumber(cards.payingOperators)}
        icon={<Users className="h-6 w-6" aria-hidden="true" />}
        color="bg-blue-50 text-blue-600"
        sub={
          <span title="Active plans an admin granted without a payment. They are not counted as paying.">
            {`+${formatNumber(cards.grantedOperators)} granted`}
          </span>
        }
      />
      <StatCard
        title="Due to renew in 30 days"
        value={formatSdg(dueToRenew.amount)}
        icon={<CalendarClock className="h-6 w-6" aria-hidden="true" />}
        color="bg-violet-50 text-violet-600"
        sub={
          <>
            {`${formatNumber(dueToRenew.operators)} ${dueToRenew.operators === 1 ? 'operator' : 'operators'}`}
            {dueToRenew.estimated && (
              <span title="Some plans are no longer on the price list: their amount is the operator's last payment.">
                {' · partly estimated'}
              </span>
            )}
          </>
        }
      />
      <StatCard
        title="Payments waiting"
        value={formatNumber(waiting.count)}
        icon={<Hourglass className="h-6 w-6" aria-hidden="true" />}
        // Amber only while something is waiting for a decision.
        color={waiting.count > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}
        sub={
          waiting.count > 0 ? (
            // Two pieces with a gap, not a dot: in a narrow card the link
            // drops to its own line without leaving a separator behind.
            <span className="flex flex-wrap gap-x-2">
              <span>
                {formatSdg(waiting.amount)}
                {oldest && ` · oldest ${oldest}`}
              </span>
              <Link to="/payments" className={TEXT_LINK}>
                Review
              </Link>
            </span>
          ) : (
            'Nothing to review'
          )
        }
      />
    </div>
  );
}

// --- notice -----------------------------------------------------------------

/** Operators whose payment was approved while their plan stayed switched off. */
function PaidNotActivatedNotice({ rows }: { rows: MoneyAnalytics['paidNotActivated'] }) {
  const headingId = useId();
  if (rows.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-amber-200 bg-amber-50 p-5"
    >
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <h2 id={headingId} className="text-sm font-semibold text-amber-900">
          Paid but not switched on
        </h2>
      </div>
      <p className="text-sm text-amber-900">
        {rows.length === 1
          ? 'This operator has an approved payment, but the plan they paid for was never switched on.'
          : `These ${formatNumber(rows.length)} operators each have an approved payment, but the plan they paid for was never switched on.`}{' '}
        Activate the waiting plan on the{' '}
        <Link
          to="/subscriptions"
          className="rounded-sm font-medium underline hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          Subscriptions
        </Link>{' '}
        page.
      </p>
      <ul className="mt-3 space-y-1.5">
        {rows.map((row) => (
          <li key={`${row.userId}-${row.approvedAt}`} className="text-sm text-amber-800">
            <Link
              to={`/users/${row.userId}`}
              className="rounded-sm font-semibold text-amber-900 underline hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              {row.operator}
            </Link>
            {` · ${row.planName} · ${formatSdg(row.amount)} · approved ${formatDateTime(row.approvedAt)}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- charts -----------------------------------------------------------------

/** A titled white card around one chart. */
function ChartCard({
  title,
  aside,
  caption,
  children,
}: {
  title: string;
  /** Sits opposite the title: a total, for instance. */
  aside?: ReactNode;
  /** A line under the chart for what the drawing cannot say itself. */
  caption?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={CARD}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <h2 id={headingId} className={CARD_TITLE}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
      {caption && <p className="mt-3 text-xs text-slate-500">{caption}</p>}
    </section>
  );
}

// --- tables -----------------------------------------------------------------

/** An operator's name, linked to their page while they still have one, and their email. */
function OperatorName({
  userId,
  name,
  email,
  deleted = false,
  tag,
}: {
  userId: string;
  name: string;
  email: string | null;
  deleted?: boolean;
  tag?: ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {deleted ? (
          <span className="font-medium text-slate-900">{name}</span>
        ) : (
          <Link to={`/users/${userId}`} className={TEXT_LINK}>
            {name}
          </Link>
        )}
        {deleted && <span className="text-xs text-slate-500">(deleted)</span>}
        {tag}
      </div>
      {/* One line: a tight table scrolls sideways before it breaks an address in two. */}
      {email && <div className="whitespace-nowrap text-xs text-slate-500">{email}</div>}
    </div>
  );
}

const DUE_COLUMNS: Column<RenewalDueRow>[] = [
  {
    key: 'operator',
    header: 'Operator',
    render: (row) => (
      <OperatorName
        userId={row.userId}
        name={row.operator}
        email={row.email}
        tag={
          row.granted ? (
            <span className={TAG} title="Granted by an admin without a payment">
              granted
            </span>
          ) : null
        }
      />
    ),
  },
  { key: 'planName', header: 'Plan', render: (row) => row.planName },
  { key: 'endsAt', header: 'Ends', nowrap: true, render: (row) => formatDate(row.endsAt) },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    render: (row) =>
      row.amount === null ? (
        '—'
      ) : (
        <>
          {/* Before the figure, so the amounts of the column stay lined up. */}
          {row.estimated && (
            <span
              className="mr-1.5 text-xs text-slate-500"
              title="This plan is no longer on the price list: the amount is the operator's last payment."
            >
              est.
            </span>
          )}
          {formatSdg(row.amount)}
        </>
      ),
  },
  {
    // A count of earlier payments, not an amount.
    key: 'paidBefore',
    header: 'Paid before',
    align: 'right',
    render: (row) => paidBeforeLabel(row.paidBefore),
  },
];

const LOST_COLUMNS: Column<LostOperatorRow>[] = [
  {
    key: 'operator',
    header: 'Operator',
    render: (row) => (
      <OperatorName userId={row.userId} name={row.operator} email={row.email} deleted={row.deleted} />
    ),
  },
  { key: 'planName', header: 'Plan', render: (row) => row.planName },
  { key: 'endedAt', header: 'Ended', nowrap: true, render: (row) => formatDate(row.endedAt) },
  {
    key: 'monthsPaid',
    header: 'Months paid',
    align: 'right',
    render: (row) => formatNumber(row.monthsPaid),
  },
  {
    key: 'totalPaid',
    header: 'Total paid',
    align: 'right',
    render: (row) => formatSdg(row.totalPaid),
  },
];

/**
 * A titled table with its CSV export. The rows are all in the browser, in the
 * order the server sent them, and are paged here; the export is made by the
 * server for the same period.
 */
function MoneyTable<T extends object>({
  title,
  caption,
  exportPath,
  period,
  columns,
  rows,
  rowKey,
  emptyMessage,
}: {
  title: string;
  caption?: string;
  exportPath: string;
  period: PeriodQuery;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage: string;
}) {
  const headingId = useId();
  const [page, setPage] = useState(1);
  // A refetch can shorten the list under the page being shown.
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={headingId} className={CARD_TITLE}>
            {title}
          </h2>
          {caption && <p className="mt-1 text-xs text-slate-500">{caption}</p>}
        </div>
        <ExportCsvButton path={exportPath} params={periodToParams(period)} />
      </div>
      <DataTable
        columns={columns}
        data={rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)}
        total={rows.length}
        page={current}
        limit={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={rowKey}
        emptyMessage={emptyMessage}
      />
    </section>
  );
}

// --- loading ----------------------------------------------------------------

function BlockSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`${CARD} animate-pulse ${className}`}>
      <div className="h-4 w-36 rounded bg-slate-200" />
      <div className="mt-4 rounded bg-slate-100" style={{ height: CHART_HEIGHT }} />
    </div>
  );
}

/** The first load: grey blocks where the cards, charts and tables will be. */
function MoneySkeleton() {
  return (
    <div role="status" aria-label="Loading money figures" className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`${CARD} flex animate-pulse items-center gap-4`}>
            <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-200" />
            <div className="min-w-0 flex-1">
              <div className="h-3 w-24 rounded bg-slate-200" />
              <div className="mt-3 h-6 w-32 rounded bg-slate-200" />
            </div>
          </div>
        ))}
      </div>
      <BlockSkeleton />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BlockSkeleton />
        <BlockSkeleton />
      </div>
      <BlockSkeleton />
    </div>
  );
}

// --- tab --------------------------------------------------------------------

/**
 * The Money tab: what came in, who is due to pay next and who stopped paying.
 *
 * One request per period. Money is read live from the payments, so the tab is
 * stamped "Live" rather than with the time of an hourly summary. While another
 * period loads, the figures on screen stay, dimmed, instead of flashing a
 * skeleton.
 */
export default function MoneyTab({ period }: { period: PeriodQuery }) {
  const query = useQuery({
    queryKey: analyticsKey('money', period),
    queryFn: () => fetchMoney(period),
    placeholderData: keepPreviousData,
  });

  if (query.isError) {
    return <ErrorPanel message={apiErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  }
  if (!query.data) return <MoneySkeleton />;

  const { data, meta } = query.data;
  const loadingNext = query.isPlaceholderData;
  const planNames = planLabels(data.incomeByPlan);
  // Every month of the range arrives, with or without income. Months of
  // nothing but zeros say less than the empty block does.
  const hasIncome = data.incomeByMonth.some(
    (month) => month.new > 0 || month.renewal > 0 || month.planChange > 0,
  );
  // Only a bar that is drawn can be lighter: a month with no rate, or 0%, has none.
  const hasProvisional = data.renewalRate.some(
    (month) => month.provisional && (month.ratePct ?? 0) > 0,
  );
  // A new period starts both tables on their first page again.
  const tableKey = periodKey(period);

  return (
    <div
      data-testid="money-figures"
      aria-busy={loadingNext}
      className={`space-y-6 transition-opacity duration-200 ${loadingNext ? 'opacity-60' : ''}`}
    >
      <div className="space-y-3">
        <div className="flex justify-end">
          <RefreshedStamp live dataUpdatedAt={query.dataUpdatedAt} />
        </div>
        <MoneyCards cards={data.cards} meta={meta} />
      </div>

      <PaidNotActivatedNotice rows={data.paidNotActivated} />

      <ChartCard
        title="Income per month"
        aside={
          <div className="sm:text-right">
            <p className="text-xs text-slate-500">Total, {rangeLabel(meta.range)}</p>
            <p className="text-lg font-semibold text-slate-900">{formatSdg(data.income.total)}</p>
            {data.income.fromDeletedOperators > 0 && (
              <p className="text-xs text-slate-500">
                {`Includes ${formatSdg(data.income.fromDeletedOperators)} from deleted operators`}
              </p>
            )}
          </div>
        }
      >
        <BarChart
          ariaLabel="Income per month"
          height={CHART_HEIGHT}
          data={
            hasIncome
              ? data.incomeByMonth.map((month) => ({
                  label: formatMonth(month.month),
                  values: { new: month.new, renewal: month.renewal, planChange: month.planChange },
                }))
              : []
          }
          series={INCOME_SERIES}
          stacked
          valueFormat={formatSdg}
          axisFormat={formatCompact}
          emptyMessage="No income in this period"
        />
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Income by plan">
          <ShareBars
            ariaLabel="Income by plan"
            height={CHART_HEIGHT}
            items={data.incomeByPlan.map((plan, i) => ({ label: planNames[i], value: plan.amount }))}
            valueFormat={formatSdg}
            emptyMessage="No income in this period"
          />
        </ChartCard>

        <ChartCard
          title="Renewal rate per month"
          caption={
            <>
              Of the paid plans that ended in a month, the share paid for again within 30 days.
              {hasProvisional &&
                ' Lighter bars are not final: those operators still have time to renew.'}
            </>
          }
        >
          <BarChart
            ariaLabel="Renewal rate per month"
            height={CHART_HEIGHT}
            data={data.renewalRate.map((month) => ({
              label: formatMonth(month.month),
              // null when no paid plan ended that month: an empty column that
              // reads as a dash. A real 0% is a value and reads "0%".
              values: { rate: month.ratePct },
              muted: month.provisional,
            }))}
            series={RATE_SERIES}
            yMax={100}
            valueFormat={formatPercent}
            axisFormat={formatPercent}
            emptyMessage="No paid plans ended in this period"
          />
        </ChartCard>
      </div>

      <MoneyTable
        key={`due-${tableKey}`}
        title="Renewals due in the next 30 days"
        exportPath="/admin/analytics/money/renewals-due/export"
        period={period}
        columns={DUE_COLUMNS}
        rows={data.renewalsDue}
        rowKey={(row) => `${row.userId}-${row.endsAt}`}
        emptyMessage="No renewals due in the next 30 days."
      />

      <MoneyTable
        key={`lost-${tableKey}`}
        title="Operators lost"
        caption="Their last paid plan ended in this period and they have not paid again."
        exportPath="/admin/analytics/money/lost/export"
        period={period}
        columns={LOST_COLUMNS}
        rows={data.lost}
        rowKey={(row) => `${row.userId}-${row.endedAt}`}
        emptyMessage="No operators lost in this period."
      />

      <p className="text-xs text-slate-500">
        {`Income is counted on the day a payment was approved, ${zoneName(meta.timezone)} time.`}
      </p>
    </div>
  );
}
