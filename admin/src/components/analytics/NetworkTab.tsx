import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Banknote,
  Info,
  Router as RouterIcon,
  Search,
  Ticket,
  TriangleAlert,
  Unplug,
} from 'lucide-react';
import {
  analyticsKey,
  fetchNetwork,
  type AnalyticsMeta,
  type NetworkAnalytics,
  type RouterRow,
} from '../../lib/analytics';
import { formatDay } from '../../lib/datetime';
import {
  apiErrorMessage,
  formatBytes,
  formatDuration,
  formatNumber,
  formatPercent,
  formatSdg,
} from '../../lib/format';
import { isDay, rangeDays, type PeriodQuery } from '../../lib/period';
import DataTable, { type Column } from '../DataTable';
import ErrorPanel from '../ErrorPanel';
import ExportCsvButton from '../ExportCsvButton';
import StatCard from '../StatCard';
import StatusBadge from '../StatusBadge';
import BarChart from '../charts/BarChart';
import HeatGrid from '../charts/HeatGrid';
import LineChart from '../charts/LineChart';
import ShareBars from '../charts/ShareBars';
import { SERIES_BLUE, SERIES_VIOLET, type Series } from '../charts/chartCore';
import FilterChips from './FilterChips';
import RefreshedStamp from './RefreshedStamp';
import { SEARCH_MAX_LENGTH, useAnalyticsTable, type TableFilter } from './useAnalyticsTable';

const CARD = 'rounded-xl border border-slate-200 bg-white p-6';
// One, two or four cards across, as on the other analytics tabs.
const CARD_GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4';
const TEXT_LINK =
  'rounded-sm font-medium text-blue-600 hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const TAG_WARNING =
  'inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20';

/** While router history is this young, the shortest preset reaches back past its start. */
const YOUNG_HISTORY_DAYS = 30;

/**
 * From this amount up, the sales card shows the short form ("SDG 21.9M") and
 * prints the exact amount on the line under it. A stat card sets a longer
 * value in smaller type, or on two lines, and the rounded amount keeps this
 * card in step with the three beside it. Below it the exact amount fits at
 * full size wherever the cards are four across.
 */
const SHORT_AMOUNT_FROM = 10_000_000;
// 'en', not 'en-GB': browsers print the British short form in lower case ("21.9m").
const shortAmountFmt = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumSignificantDigits: 3,
});

// --- charts -----------------------------------------------------------------

const CARD_SERIES: Series[] = [
  { key: 'created', label: 'Created', colorClass: SERIES_BLUE },
  // Dashed as well as violet: the two lines are told apart by more than colour.
  { key: 'used', label: 'Used', colorClass: SERIES_VIOLET, dashed: true },
];

const DATA_SERIES: Series[] = [{ key: 'data', label: 'Data used', colorClass: SERIES_BLUE }];

/** Rows of the busiest-hours grid: the week starts on Saturday. `dow` is the API's, 0 = Sunday. */
const WEEK = [
  { dow: 6, label: 'Sat' },
  { dow: 0, label: 'Sun' },
  { dow: 1, label: 'Mon' },
  { dow: 2, label: 'Tue' },
  { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' },
  { dow: 5, label: 'Fri' },
];
const WEEK_LABELS = WEEK.map((day) => day.label);
const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Sessions as `cells[row][hour]`, rows in WEEK order. Hours the API left out are zero. */
function hourCells(hours: NetworkAnalytics['hours']): number[][] {
  const cells = WEEK.map(() => Array.from({ length: 24 }, () => 0));
  for (const { dow, hour, sessions } of hours) {
    const row = WEEK.findIndex((day) => day.dow === dow);
    if (row === -1 || !Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    cells[row][hour] += sessions;
  }
  return cells;
}

/**
 * The byte unit the largest day reads best in. The bar chart is drawn in that
 * unit, not in raw bytes: axis ticks are round decimal steps, and round steps
 * of bytes read "19 GB, 37 GB, 56 GB".
 */
function byteScale(maxBytes: number): { size: number; unit: string } {
  let size = 1;
  let index = 0;
  while (maxBytes >= size * 1024 && index < BYTE_UNITS.length - 1) {
    size *= 1024;
    index += 1;
  }
  return { size, unit: BYTE_UNITS[index] };
}

function kindLabel(limitType: string | null): string {
  switch (limitType) {
    case null:
      return 'No limit';
    case 'time':
      return 'Time-limited';
    case 'data':
      return 'Data-limited';
    default:
      return limitType;
  }
}

// --- notes ------------------------------------------------------------------

/** "2026-11-10" → "10 Nov 2026". */
function dayWithYear(day: string): string {
  const label = formatDay(day);
  return label === day ? day : `${label} ${day.slice(0, 4)}`;
}

/** "Africa/Khartoum" → "Khartoum": the place whose calendar the days follow. */
function zoneName(timezone: string): string {
  return (timezone.split('/').pop() || timezone).replace(/_/g, ' ');
}

/** What the reader should know before trusting the figures of this response. */
function noticesFor(data: NetworkAnalytics, meta: AnalyticsMeta): string[] {
  const notices: string[] = [];
  if (data.monitorStale) {
    notices.push(
      'Live router status is unknown: the router monitor has not reported for over 3 minutes',
    );
  }
  const start = meta.routerHistoryStart;
  if (start === null) {
    notices.push('Router uptime starts recording at launch');
  } else if (
    isDay(start) &&
    isDay(meta.range.to) &&
    // Counted to the last day shown, which for a preset is today.
    rangeDays(start, meta.range.to) <= YOUNG_HISTORY_DAYS
  ) {
    notices.push(`Router history began on ${dayWithYear(start)}`);
  }
  if (meta.range.from < meta.usageHistoryStart) {
    notices.push(`Use history begins on ${dayWithYear(meta.usageHistoryStart)}`);
  }
  const unpriced = data.cards.unpricedUsed;
  if (unpriced > 0) {
    notices.push(
      `Sales value excludes ${formatNumber(unpriced)} ${unpriced === 1 ? 'card' : 'cards'} with no price`,
    );
  }
  return notices;
}

function Notices({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section
      aria-label="About these figures"
      className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3"
    >
      <ul className="space-y-1.5">
        {items.map((text) => (
          <li key={text} className="flex items-start gap-2 text-sm text-blue-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- cards ------------------------------------------------------------------

function NetworkCards({ data }: { data: NetworkAnalytics }) {
  const { cards, monitorStale } = data;
  const routerNotes = [
    `Uptime ${formatPercent(cards.uptimePct, 1)}`,
    cards.neverConnected > 0 ? `${formatNumber(cards.neverConnected)} never connected` : null,
    cards.notSeenSinceLaunch > 0
      ? `${formatNumber(cards.notSeenSinceLaunch)} not seen since launch`
      : null,
  ]
    .filter((note): note is string => note !== null)
    .join(' · ');
  const shortSales = Number.isFinite(cards.salesValue) && cards.salesValue >= SHORT_AMOUNT_FROM;

  return (
    <div role="group" aria-label="Network and card totals" className={CARD_GRID}>
      <StatCard
        title="Routers online now"
        // A silent monitor marks every router offline: a count would be a wrong number.
        value={
          monitorStale
            ? '—'
            : `${formatNumber(cards.routersOnline)} of ${formatNumber(cards.routersTotal)}`
        }
        icon={<RouterIcon className="h-6 w-6" aria-hidden="true" />}
        color={monitorStale ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}
        sub={
          monitorStale ? (
            <>
              <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                Status unknown
              </span>
              {` · ${routerNotes}`}
            </>
          ) : (
            routerNotes
          )
        }
      />
      <StatCard
        title="Keep dropping"
        value={formatNumber(cards.dropping)}
        icon={<Unplug className="h-6 w-6" aria-hidden="true" />}
        // Amber only while there is a router to look at.
        color={cards.dropping > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}
        sub="5+ drops in the last 7 days"
      />
      <StatCard
        title="Cards used"
        value={formatNumber(cards.cardsUsed)}
        icon={<Ticket className="h-6 w-6" aria-hidden="true" />}
        color="bg-violet-50 text-violet-600"
        sub={`of ${formatNumber(cards.cardsCreated)} created`}
      />
      <StatCard
        title="Sales value"
        value={
          shortSales
            ? `SDG ${shortAmountFmt.format(cards.salesValue)}`
            : formatSdg(cards.salesValue)
        }
        icon={<Banknote className="h-6 w-6" aria-hidden="true" />}
        color="bg-emerald-50 text-emerald-600"
        sub={`${
          shortSales ? `${formatSdg(cards.salesValue)} of` : 'Of'
        } used cards. Operators' own sales, not Wasel income.`}
      />
    </div>
  );
}

// --- panels -----------------------------------------------------------------

/** A titled white card: one chart, or one list. */
function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={`min-w-0 ${CARD}`}>
      <div className="mb-4">
        <h2 id={headingId} className="text-sm font-semibold text-slate-900">
          {title}
        </h2>
        {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}

// --- routers table ----------------------------------------------------------

/**
 * The eight columns, in the order of the screen. The keys are the `sort` values
 * of the export endpoint.
 */
const ROUTER_COLUMNS: Column<RouterRow>[] = [
  {
    key: 'router',
    header: 'Router',
    sortValue: (row) => row.router,
    render: (row) => (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-slate-900">{row.router}</span>
        {row.flags.dropping && (
          <span className={TAG_WARNING} title="5 or more drops in the last 7 days">
            Dropping
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'operator',
    header: 'Operator',
    sortValue: (row) => row.operator,
    render: (row) => (
      <Link to={`/users/${encodeURIComponent(row.userId)}`} className={TEXT_LINK}>
        {row.operator}
      </Link>
    ),
  },
  {
    key: 'uptimePct',
    header: 'Uptime',
    align: 'right',
    sortValue: (row) => row.uptimePct,
    render: (row) => formatPercent(row.uptimePct, 1),
  },
  {
    key: 'drops',
    header: 'Drops',
    align: 'right',
    sortValue: (row) => row.drops,
    render: (row) => formatNumber(row.drops),
  },
  {
    key: 'longestOutageSec',
    header: 'Longest outage',
    align: 'right',
    sortValue: (row) => row.longestOutageSec,
    render: (row) => (row.longestOutageSec > 0 ? formatDuration(row.longestOutageSec) : '—'),
  },
  {
    key: 'sessions',
    header: 'Sessions',
    align: 'right',
    sortValue: (row) => row.sessions,
    render: (row) => formatNumber(row.sessions),
  },
  {
    key: 'dataBytes',
    header: 'Data',
    align: 'right',
    sortValue: (row) => row.dataBytes,
    render: (row) => formatBytes(row.dataBytes),
  },
  {
    key: 'status',
    header: 'Now',
    // As the server sent it: "unknown" for every router while the monitor is silent.
    sortValue: (row) => row.status,
    render: (row) => <StatusBadge status={row.status} />,
  },
];

// The chip keys are the `filter` values of the export endpoint.
type RouterFilter = 'all' | 'dropping' | 'offline';

/** The flags are set by the server; the browser only picks the rows. */
const FILTERS: TableFilter<RouterRow, RouterFilter>[] = [
  { key: 'all', label: 'All', keep: () => true },
  { key: 'dropping', label: 'Dropping', keep: (row) => row.flags.dropping },
  { key: 'offline', label: 'Offline now', keep: (row) => row.flags.offlineNow },
];

/**
 * The routers table with its search, chips, sort, paging and export.
 *
 * Rows arrive worst first (lowest uptime, then most drops) and stay in that
 * order until a column is sorted. Search, chips and sort run in the browser on
 * the rows and flags the server sent; the export sends the same choices to the
 * server. They live in the URL as `q`, `filter`, `sort` and `dir`, so a view
 * can be linked and survives a reload, and the page drops them when another
 * tab is opened.
 */
function RoutersTable({ rows, period }: { rows: RouterRow[]; period: PeriodQuery }) {
  const headingId = useId();
  const table = useAnalyticsTable({
    rows,
    period,
    columns: ROUTER_COLUMNS,
    filters: FILTERS,
    searchIn: (row) => [row.router, row.operator],
  });

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-sm font-semibold text-slate-900">
          Routers
          {!table.sort && (
            <span title="Lowest uptime first, then most drops" className="font-normal text-slate-500">
              {' '}
              · worst first
            </span>
          )}
        </h2>
        <ExportCsvButton
          path="/admin/analytics/network/routers/export"
          params={table.exportParams}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search routers"
            placeholder="Search router or operator"
            value={table.q}
            maxLength={SEARCH_MAX_LENGTH}
            onChange={(event) => table.setQ(event.target.value)}
            className="w-64 max-w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <FilterChips
          ariaLabel="Filter routers"
          options={table.filterOptions}
          value={table.filter}
          onChange={table.setFilter}
        />
      </div>

      <DataTable
        columns={ROUTER_COLUMNS}
        data={table.pageRows}
        total={table.total}
        page={table.page}
        limit={table.limit}
        onPageChange={table.setPage}
        sort={table.sort ?? undefined}
        onSortChange={table.setSort}
        rowKey={(row) => row.routerId}
        emptyMessage={
          rows.length === 0 ? 'No routers yet.' : 'No routers match this search or filter.'
        }
      />
    </section>
  );
}

// --- loading ----------------------------------------------------------------

/** The first load: grey blocks where the cards and the charts will be. */
function NetworkSkeleton() {
  const chart = (
    <div className={`${CARD} animate-pulse`}>
      <div className="h-4 w-40 rounded bg-slate-200" />
      <div className="mt-4 h-60 rounded bg-slate-100" />
    </div>
  );
  return (
    <div role="status" aria-label="Loading network and card figures" className="space-y-6">
      <div className={CARD_GRID}>
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
      {chart}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {chart}
        {chart}
      </div>
    </div>
  );
}

// --- tab --------------------------------------------------------------------

/**
 * The "Network and cards" tab: how the routers hold up and how cards are used.
 *
 * One request per period. The figures come from the hourly summaries, so the
 * tab is stamped with the time of the last one; only "online now" and the Now
 * column are live, and they read "unknown" while the router monitor is silent.
 * While another period loads, the figures on screen stay, dimmed, instead of
 * flashing a skeleton.
 */
export default function NetworkTab({ period }: { period: PeriodQuery }) {
  const query = useQuery({
    queryKey: analyticsKey('network', period),
    queryFn: () => fetchNetwork(period),
    placeholderData: keepPreviousData,
  });

  if (query.isError) {
    return <ErrorPanel message={apiErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  }
  if (!query.data) return <NetworkSkeleton />;

  const { data, meta } = query.data;
  const loadingNext = query.isPlaceholderData;
  const zone = zoneName(meta.timezone);

  // Only a range longer than a year shows the same day and month twice.
  const firstDay = data.daily[0]?.day;
  const lastDay = data.daily[data.daily.length - 1]?.day;
  const overAYear =
    firstDay !== undefined &&
    lastDay !== undefined &&
    isDay(firstDay) &&
    isDay(lastDay) &&
    rangeDays(firstDay, lastDay) > 365;
  const dayLabel = (day: string) => (overAYear ? dayWithYear(day) : formatDay(day));

  const scale = byteScale(Math.max(0, ...data.daily.map((d) => d.dataBytes)));

  return (
    <div
      aria-busy={loadingNext}
      className={`space-y-6 transition-opacity duration-200 ${loadingNext ? 'opacity-60' : ''}`}
    >
      <div className="flex justify-end">
        <RefreshedStamp refreshedAt={meta.refreshedAt} stale={meta.stale} />
      </div>

      <NetworkCards data={data} />

      <Notices items={noticesFor(data, meta)} />

      <Panel title="Cards created and used per day">
        <LineChart
          ariaLabel="Cards created and used per day"
          points={data.daily.map((d) => ({
            label: dayLabel(d.day),
            values: {
              created: d.cardsCreated,
              // Before the use history starts nothing was recorded: a gap, not a zero.
              used: d.day < meta.usageHistoryStart ? null : d.cardsUsed,
            },
          }))}
          series={CARD_SERIES}
          emptyMessage="No cards in this period"
        />
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Busiest hours" note={`Sessions by weekday and hour, ${zone} time`}>
          <HeatGrid
            ariaLabel="Busiest hours"
            cells={hourCells(data.hours)}
            rowLabels={WEEK_LABELS}
            colLabels={HOUR_LABELS}
            valueFormat={(n) => `${formatNumber(n)} ${n === 1 ? 'session' : 'sessions'}`}
            emptyMessage="No sessions in this period"
          />
        </Panel>

        <Panel title="Data used per day" note="Counted on the day a session started">
          <BarChart
            ariaLabel="Data used per day"
            data={data.daily.map((d) => ({
              label: dayLabel(d.day),
              values: { data: d.dataBytes / scale.size },
            }))}
            series={DATA_SERIES}
            valueFormat={(n) => formatBytes(n * scale.size)}
            axisFormat={(n) => `${formatNumber(n)} ${scale.unit}`}
            emptyMessage="No data use in this period"
          />
        </Panel>
      </div>

      <RoutersTable rows={data.routers} period={period} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Card types by price" note="Cards used in this period">
          <ShareBars
            ariaLabel="Cards used by price"
            items={data.cardTypes.byPrice.map((type) => ({
              label: type.price === null ? 'No price' : formatSdg(type.price),
              value: type.cardsUsed,
            }))}
            emptyMessage="No cards used in this period"
          />
        </Panel>

        <Panel title="Card types by kind" note="Cards used in this period">
          <ShareBars
            ariaLabel="Cards used by kind"
            items={data.cardTypes.byKind.map((type) => ({
              label: kindLabel(type.limitType),
              value: type.cardsUsed,
            }))}
            emptyMessage="No cards used in this period"
          />
        </Panel>
      </div>

      <p className="text-xs text-slate-500">
        {`Days and hours are ${zone} time. A card counts as used on the day of its first login.`}
      </p>
    </div>
  );
}
