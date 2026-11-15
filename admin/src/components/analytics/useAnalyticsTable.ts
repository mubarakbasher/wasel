import { useEffect, useState } from 'react';
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import { periodKey, periodToParams, type PeriodQuery } from '../../lib/period';
import { matchesSearch, sortRows, type SortState } from '../../lib/tableSort';
import type { Column } from '../DataTable';
import type { FilterChipOption } from './FilterChips';

/** Rows of a table shown at once; the rest are a page away. */
export const PAGE_SIZE = 20;
/** The longest search the export endpoints accept. */
export const SEARCH_MAX_LENGTH = 100;
/** How long the table state rests before it is copied into the URL. */
const URL_WRITE_DELAY_MS = 300;

/** One chip above the table. The key is the `filter` value of the export endpoint. */
export interface TableFilter<T, K extends string = string> {
  key: K;
  label: string;
  /** The flags are set by the server; the browser only picks the rows. */
  keep: (row: T) => boolean;
}

interface TableState<K extends string> {
  q: string;
  filter: K;
  /** null shows the rows in the order the server sent them. */
  sort: SortState | null;
}

// The query-string keys the table owns. The page keeps them through a period
// change and drops them on a tab switch.
const TABLE_PARAMS = ['q', 'filter', 'sort', 'dir'] as const;
type TableParams = Record<(typeof TABLE_PARAMS)[number], string | undefined>;

/** The table state a URL carries. Anything the table does not know is ignored. */
function readTableState<T, K extends string>(
  params: URLSearchParams,
  filters: TableFilter<T, K>[],
  columns: Column<T>[],
): TableState<K> {
  const filter = filters.find((f) => f.key === params.get('filter')) ?? filters[0];
  const sortKey = params.get('sort');
  const sortable = columns.some((column) => column.key === sortKey && column.sortValue);
  return {
    q: (params.get('q') ?? '').slice(0, SEARCH_MAX_LENGTH),
    filter: filter.key,
    sort:
      sortKey !== null && sortable
        ? { key: sortKey, dir: params.get('dir') === 'desc' ? 'desc' : 'asc' }
        : null,
  };
}

/** The table state as query parameters, for the URL and for the export. */
function tableParams<K extends string>(state: TableState<K>, defaultFilter: K): TableParams {
  return {
    q: state.q.trim() || undefined,
    filter: state.filter === defaultFilter ? undefined : state.filter,
    sort: state.sort?.key,
    dir: state.sort?.dir,
  };
}

/**
 * How the table writes its state into the URL: in place, and marked as its
 * own, so it can tell its own change from a link or the period picker.
 */
const TABLE_NAVIGATION = { replace: true, state: { analyticsTable: true } };

function isTableNavigation(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { analyticsTable?: unknown }).analyticsTable === true
  );
}

export interface AnalyticsTableOptions<T, K extends string> {
  /** Every row of the table, in the order the server sent them. */
  rows: T[];
  /** The period the rows belong to: it travels with the export. */
  period: PeriodQuery;
  /** The columns shown. One with a `sortValue` can be sorted, by its key. */
  columns: Column<T>[];
  /** The chips, in display order. The first keeps every row and is the default. */
  filters: TableFilter<T, K>[];
  /** The fields of a row the search box looks in. */
  searchIn: (row: T) => (string | null)[];
}

export interface AnalyticsTable<T, K extends string> {
  /** The search text, as typed. */
  q: string;
  setQ: (q: string) => void;
  /** Key of the active chip. */
  filter: K;
  setFilter: (filter: K) => void;
  /** The chips, each with how many of the searched rows it keeps. */
  filterOptions: FilterChipOption<K>[];
  /** null while the rows are in the order the server sent them. */
  sort: SortState | null;
  setSort: (sort: SortState) => void;
  /** The rows of the page on screen, searched, filtered and sorted. */
  pageRows: T[];
  /** How many rows the search and the chip keep, over every page. */
  total: number;
  page: number;
  setPage: (page: number) => void;
  /** Rows per page. */
  limit: number;
  /** The period and the table's choices, as the export endpoint takes them. */
  exportParams: Record<string, string | undefined>;
}

/**
 * The state of an analytics table whose rows are all in the browser: search,
 * chips, sort and paging.
 *
 * Search, chips and sort run in the browser on the rows and flags the server
 * sent; the export sends the same choices to the server. They live in the URL
 * as `q`, `filter`, `sort` and `dir`, so a view can be linked and survives a
 * reload, and the page drops them when another tab is opened.
 */
export function useAnalyticsTable<T, K extends string>({
  rows,
  period,
  columns,
  filters,
  searchIn,
}: AnalyticsTableOptions<T, K>): AnalyticsTable<T, K> {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultFilter = filters[0].key;

  // The router applies a URL change as a transition, which is too late for a
  // controlled input (typed characters would be dropped). So the table keeps
  // its own state, answers from it at once, and the URL follows.
  const [table, setTable] = useState<TableState<K>>(() =>
    readTableState(searchParams, filters, columns),
  );

  // A URL change the table did not make is taken over when it touches the
  // table's parameters: the tab's own link drops them, the Back button may
  // bring older ones. The period picker leaves them alone, so a choice that is
  // still on its way to the URL is kept. Adjusted during render rather than in
  // an effect, so the stale state is never painted.
  const urlTable = JSON.stringify(TABLE_PARAMS.map((key) => searchParams.get(key)));
  const [seen, setSeen] = useState({ key: location.key, urlTable });
  if (seen.key !== location.key) {
    setSeen({ key: location.key, urlTable });
    const ownWrite = navigationType !== 'POP' && isTableNavigation(location.state);
    if (!ownWrite && urlTable !== seen.urlTable) {
      setTable(readTableState(searchParams, filters, columns));
    }
  }

  // Copy the table state into the URL after a short rest: browsers limit how
  // often a page may rewrite its URL, and a search box changes on every key.
  useEffect(() => {
    const wanted = tableParams(table, defaultFilter);
    if (TABLE_PARAMS.every((key) => (searchParams.get(key) ?? undefined) === wanted[key])) return;
    const timer = window.setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const key of TABLE_PARAMS) {
          const value = wanted[key];
          if (value === undefined) next.delete(key);
          else next.set(key, value);
        }
        return next;
      }, TABLE_NAVIGATION);
    }, URL_WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [table, defaultFilter, searchParams, setSearchParams]);

  // The page number belongs to one view of the table. Any change of period,
  // search, filter or sort is another view, and starts on its first page.
  const params = tableParams(table, defaultFilter);
  const viewKey = JSON.stringify([periodKey(period), params]);
  const [paging, setPaging] = useState({ viewKey, page: 1 });

  const searched = rows.filter((row) => matchesSearch(searchIn(row), table.q));
  const filter = filters.find((f) => f.key === table.filter) ?? filters[0];
  const kept = searched.filter(filter.keep);
  const sort = table.sort;
  const sortValue = sort ? columns.find((column) => column.key === sort.key)?.sortValue : undefined;
  const ordered = sort && sortValue ? sortRows(kept, sortValue, sort.dir) : kept;

  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const page = paging.viewKey === viewKey ? Math.min(paging.page, pages) : 1;

  return {
    q: table.q,
    setQ: (q) => setTable((current) => ({ ...current, q })),
    filter: table.filter,
    setFilter: (key) => setTable((current) => ({ ...current, filter: key })),
    // Each chip says how many of the searched rows it keeps.
    filterOptions: filters.map((f) => ({
      key: f.key,
      label: f.label,
      count: searched.filter(f.keep).length,
    })),
    sort,
    setSort: (next) => setTable((current) => ({ ...current, sort: next })),
    pageRows: ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: ordered.length,
    page,
    setPage: (next) => setPaging({ viewKey, page: next }),
    limit: PAGE_SIZE,
    exportParams: { ...periodToParams(period), ...params },
  };
}
