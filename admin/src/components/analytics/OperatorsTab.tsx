import { useId } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CircleDashed, Gauge, Info, Search, TrendingDown, Users } from 'lucide-react';
import {
  analyticsKey,
  fetchOperators,
  type AnalyticsMeta,
  type OperatorRow,
  type OperatorsAnalytics,
} from '../../lib/analytics';
import { formatDateTime, formatDay } from '../../lib/datetime';
import {
  apiErrorMessage,
  changeSign,
  formatChange,
  formatNumber,
  formatSdg,
} from '../../lib/format';
import type { PeriodQuery } from '../../lib/period';
import DataTable, { type Column } from '../DataTable';
import ErrorPanel from '../ErrorPanel';
import ExportCsvButton from '../ExportCsvButton';
import StatCard from '../StatCard';
import FilterChips from './FilterChips';
import RefreshedStamp from './RefreshedStamp';
import { SEARCH_MAX_LENGTH, useAnalyticsTable, type TableFilter } from './useAnalyticsTable';

const CARD = 'rounded-xl border border-slate-200 bg-white p-6';
const TEXT_LINK =
  'rounded-sm font-medium text-blue-600 hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const TAG = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset';
const TAG_WARNING = `${TAG} bg-amber-50 text-amber-700 ring-amber-600/20`;
const TAG_NEUTRAL = `${TAG} bg-slate-100 text-slate-600 ring-slate-500/20`;

// --- filters ----------------------------------------------------------------

// The chip keys are the `filter` values of the export endpoint.
type OperatorFilter = 'all' | 'quiet' | 'near-limit' | 'not-started';

/** The flags are set by the server; the browser only picks the rows. */
const FILTERS: TableFilter<OperatorRow, OperatorFilter>[] = [
  { key: 'all', label: 'All', keep: () => true },
  { key: 'quiet', label: 'Quiet', keep: (row) => row.flags.isQuiet },
  { key: 'near-limit', label: 'Near limit', keep: (row) => row.flags.nearLimit },
  { key: 'not-started', label: 'Not started', keep: (row) => row.flags.notStarted },
];

// --- columns ----------------------------------------------------------------

function OperatorCell({ row }: { row: OperatorRow }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link to={`/users/${encodeURIComponent(row.userId)}`} className={TEXT_LINK}>
          {row.operator}
        </Link>
        {row.flags.isQuiet && (
          <span className={TAG_WARNING} title="Used half as many cards as in the period before, or fewer">
            Quiet
          </span>
        )}
        {row.flags.nearLimit && (
          <span className={TAG_WARNING} title="Has used 80% or more of the plan's cards">
            Near limit
          </span>
        )}
        {row.flags.notStarted && (
          <span className={TAG_NEUTRAL} title="No router or no cards yet">
            Not started
          </span>
        )}
      </div>
      {/* One line: a tight table scrolls sideways before it breaks an address in two. */}
      <div className="whitespace-nowrap text-xs text-slate-500">{row.email}</div>
    </div>
  );
}

/**
 * Green for a rise, red for a fall, grey for no change and for no figure. The
 * colour comes from the number, never from how it is printed; the sign in the
 * text says the same thing without colour.
 */
function changeTone(changePct: number | null): string {
  switch (changeSign(changePct)) {
    case 1:
      return 'text-green-700';
    case -1:
      return 'text-red-700';
    default:
      return 'text-slate-500';
  }
}

function ChangeCell({ changePct }: { changePct: number | null }) {
  return (
    <span className={`font-medium ${changeTone(changePct)}`}>{formatChange(changePct)}</span>
  );
}

function timeValue(iso: string | null): number | null {
  return iso === null ? null : Date.parse(iso);
}

// The column keys are the `sort` keys of the export endpoint.
const COLUMNS: Column<OperatorRow>[] = [
  {
    key: 'operator',
    header: 'Operator',
    sortValue: (row) => row.operator,
    render: (row) => <OperatorCell row={row} />,
  },
  {
    key: 'plan',
    header: 'Plan',
    sortValue: (row) => row.planName ?? row.planTier,
    render: (row) => row.planName ?? row.planTier ?? '—',
  },
  {
    key: 'daysLeft',
    header: 'Days left',
    align: 'right',
    sortValue: (row) => row.daysLeft,
    render: (row) => (row.daysLeft === null ? '—' : formatNumber(row.daysLeft)),
  },
  {
    key: 'routersOnline',
    header: 'Routers online',
    align: 'right',
    sortValue: (row) => row.routersOnline,
    render: (row) => `${formatNumber(row.routersOnline)} of ${formatNumber(row.routersTotal)}`,
  },
  {
    key: 'cardsCreated',
    header: 'Cards created',
    align: 'right',
    sortValue: (row) => row.cardsCreated,
    render: (row) => formatNumber(row.cardsCreated),
  },
  {
    key: 'cardsUsed',
    header: 'Cards used',
    align: 'right',
    sortValue: (row) => row.cardsUsed,
    render: (row) => formatNumber(row.cardsUsed),
  },
  {
    key: 'salesValue',
    header: 'Sales value',
    align: 'right',
    sortValue: (row) => row.salesValue,
    render: (row) => formatSdg(row.salesValue),
  },
  {
    key: 'changePct',
    header: 'Change',
    align: 'right',
    sortValue: (row) => row.changePct,
    render: (row) => <ChangeCell changePct={row.changePct} />,
  },
  {
    key: 'lastActiveAt',
    header: 'Last active',
    nowrap: true,
    sortValue: (row) => timeValue(row.lastActiveAt),
    render: (row) => formatDateTime(row.lastActiveAt),
  },
];

// --- cards ------------------------------------------------------------------

function OperatorCards({ cards }: { cards: OperatorsAnalytics['cards'] }) {
  return (
    <div
      role="group"
      aria-label="Operator totals"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4"
    >
      <StatCard
        title="Active operators"
        value={formatNumber(cards.active)}
        icon={<Users className="h-6 w-6" aria-hidden="true" />}
        color="bg-blue-50 text-blue-600"
        sub={
          <span title="Operators with at least one card used in this period">
            {`of ${formatNumber(cards.total)} ${cards.total === 1 ? 'operator' : 'operators'}`}
          </span>
        }
      />
      <StatCard
        title="Going quiet"
        value={formatNumber(cards.quiet)}
        icon={<TrendingDown className="h-6 w-6" aria-hidden="true" />}
        // Amber only while there is someone to look at.
        color={cards.quiet > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}
        sub="Card use fell by half or more"
      />
      <StatCard
        title="Near card limit"
        value={formatNumber(cards.nearLimit)}
        icon={<Gauge className="h-6 w-6" aria-hidden="true" />}
        color={cards.nearLimit > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}
        sub="80% or more of the plan's cards used"
      />
      <StatCard
        title="Not started"
        value={formatNumber(cards.notStarted)}
        icon={<CircleDashed className="h-6 w-6" aria-hidden="true" />}
        color="bg-slate-100 text-slate-500"
        sub="No router or no cards yet"
      />
    </div>
  );
}

// --- notes ------------------------------------------------------------------

/** "Africa/Khartoum" → "Khartoum": the place whose calendar the days follow. */
function zoneName(timezone: string): string {
  return (timezone.split('/').pop() || timezone).replace(/_/g, ' ');
}

/** "2026-10-20" → "20 Oct 2026". */
function dayWithYear(day: string): string {
  return `${formatDay(day)} ${day.slice(0, 4)}`;
}

/**
 * Change and Going quiet compare with the period before. While that period
 * starts before the use history does, the server leaves both empty for every
 * operator: say why, so an empty column does not look broken.
 */
function NoComparisonNote({ meta }: { meta: AnalyticsMeta }) {
  if (meta.previous.from >= meta.usageHistoryStart) return null;
  return (
    <section
      aria-label="About these figures"
      className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3"
    >
      <p className="flex items-start gap-2 text-sm text-blue-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
        <span>
          {`Change and Going quiet compare this period with the one before it. Use history begins on ${dayWithYear(
            meta.usageHistoryStart,
          )}, so both stay empty until a full earlier period exists.`}
        </span>
      </p>
    </section>
  );
}

// --- table ------------------------------------------------------------------

/**
 * The operators table with its search, chips, sort, paging and export.
 *
 * Search, chips and sort run in the browser on the rows and flags the server
 * sent; the export sends the same choices to the server. They live in the URL
 * as `q`, `filter`, `sort` and `dir`, so a view can be linked and survives a
 * reload, and the page drops them when another tab is opened.
 */
function OperatorsTable({ rows, period }: { rows: OperatorRow[]; period: PeriodQuery }) {
  const headingId = useId();
  const table = useAnalyticsTable({
    rows,
    period,
    columns: COLUMNS,
    filters: FILTERS,
    searchIn: (row) => [row.operator, row.email],
  });

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-sm font-semibold text-slate-900">
          Operators
        </h2>
        <ExportCsvButton path="/admin/analytics/operators/export" params={table.exportParams} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search operators"
            placeholder="Search operator or email"
            value={table.q}
            maxLength={SEARCH_MAX_LENGTH}
            onChange={(event) => table.setQ(event.target.value)}
            className="w-64 max-w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <FilterChips
          ariaLabel="Filter operators"
          options={table.filterOptions}
          value={table.filter}
          onChange={table.setFilter}
        />
      </div>

      <DataTable
        columns={COLUMNS}
        data={table.pageRows}
        total={table.total}
        page={table.page}
        limit={table.limit}
        onPageChange={table.setPage}
        sort={table.sort ?? undefined}
        onSortChange={table.setSort}
        rowKey={(row) => row.userId}
        emptyMessage={
          rows.length === 0 ? 'No operators yet.' : 'No operators match this search or filter.'
        }
      />
    </section>
  );
}

// --- loading ----------------------------------------------------------------

/** The first load: grey blocks where the cards and the table will be. */
function OperatorsSkeleton() {
  return (
    <div role="status" aria-label="Loading operator figures" className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`${CARD} flex animate-pulse items-center gap-4`}>
            <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-200" />
            <div className="min-w-0 flex-1">
              <div className="h-3 w-24 rounded bg-slate-200" />
              <div className="mt-3 h-6 w-16 rounded bg-slate-200" />
            </div>
          </div>
        ))}
      </div>
      <div className={`${CARD} animate-pulse`}>
        <div className="h-4 w-36 rounded bg-slate-200" />
        <div className="mt-4 h-64 rounded bg-slate-100" />
      </div>
    </div>
  );
}

// --- tab --------------------------------------------------------------------

/**
 * The Operators tab: how many operators are really working, who is slipping,
 * and one row per operator.
 *
 * One request per period. The figures come from the hourly summaries, so the
 * tab is stamped with the time of the last one. While another period loads,
 * the figures on screen stay, dimmed, instead of flashing a skeleton.
 */
export default function OperatorsTab({ period }: { period: PeriodQuery }) {
  const query = useQuery({
    queryKey: analyticsKey('operators', period),
    queryFn: () => fetchOperators(period),
    placeholderData: keepPreviousData,
  });

  if (query.isError) {
    return <ErrorPanel message={apiErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  }
  if (!query.data) return <OperatorsSkeleton />;

  const { data, meta } = query.data;
  const loadingNext = query.isPlaceholderData;

  return (
    <div
      aria-busy={loadingNext}
      className={`space-y-6 transition-opacity duration-200 ${loadingNext ? 'opacity-60' : ''}`}
    >
      <div className="flex justify-end">
        <RefreshedStamp refreshedAt={meta.refreshedAt} stale={meta.stale} />
      </div>

      <OperatorCards cards={data.cards} />

      <NoComparisonNote meta={meta} />

      <OperatorsTable rows={data.rows} period={period} />

      <p className="text-xs text-slate-500">
        {`A card counts as used on the day of its first login, ${zoneName(
          meta.timezone,
        )} time. Sales value is the operators' own card sales, not Wasel income.`}
      </p>
    </div>
  );
}
