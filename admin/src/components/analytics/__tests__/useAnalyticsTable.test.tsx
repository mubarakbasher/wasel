import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate, type NavigateOptions } from 'react-router-dom';

import type { PeriodQuery } from '../../../lib/period';
import type { Column } from '../../DataTable';
import {
  PAGE_SIZE,
  SEARCH_MAX_LENGTH,
  useAnalyticsTable,
  type TableFilter,
} from '../useAnalyticsTable';

interface Row {
  id: string;
  name: string;
  owner: string | null;
  cards: number | null;
  flagged: boolean;
}

// In the order "the server sent them".
const ROWS: Row[] = [
  { id: 'a', name: 'Souq Router', owner: 'Atbara Net', cards: 310, flagged: true },
  { id: 'b', name: 'Market AP', owner: 'Atbara Net', cards: 120, flagged: true },
  { id: 'c', name: 'Cafe Nile Main', owner: 'Cafe Nile', cards: 2_400, flagged: false },
  { id: 'd', name: 'Cafe Nile Roof', owner: 'Cafe Nile', cards: 900, flagged: false },
  { id: 'e', name: 'New Shop Router', owner: null, cards: null, flagged: false },
];
const DELIVERED = ROWS.map((row) => row.name);

const COLUMNS: Column<Row>[] = [
  { key: 'name', header: 'Name', sortValue: (row) => row.name },
  { key: 'cards', header: 'Cards', align: 'right', sortValue: (row) => row.cards },
  // No sortValue: a column the table cannot be sorted by.
  { key: 'note', header: 'Note' },
];

type Filter = 'all' | 'flagged';
const FILTERS: TableFilter<Row, Filter>[] = [
  { key: 'all', label: 'All', keep: () => true },
  { key: 'flagged', label: 'Flagged', keep: (row) => row.flagged },
];

const searchIn = (row: Row) => [row.name, row.owner];

const TAB = '/analytics/network';

interface Props {
  rows: Row[];
  period: PeriodQuery;
}

/**
 * The hook inside a router, with the router's location and `navigate` beside
 * it: the location is what the hook wrote, `navigate` is everything else that
 * changes the URL (a link, the period picker, the Back button).
 *
 * `entries` is the history so far; the last one is the page the hook opens on.
 */
function setup(entries: string | string[] = TAB, props: Partial<Props> = {}) {
  const history = Array.isArray(entries) ? entries : [entries];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={history} initialIndex={history.length - 1}>
      {children}
    </MemoryRouter>
  );
  const initialProps: Props = { rows: ROWS, period: { period: '3m' }, ...props };
  const view = renderHook(
    ({ rows, period }: Props) => ({
      table: useAnalyticsTable({ rows, period, columns: COLUMNS, filters: FILTERS, searchIn }),
      location: useLocation(),
      navigate: useNavigate(),
    }),
    { wrapper, initialProps },
  );
  return {
    ...view,
    table: () => view.result.current.table,
    /** Names of the rows on the page shown, top to bottom. */
    shown: () => view.result.current.table.pageRows.map((row) => row.name),
    path: () => view.result.current.location.pathname,
    /** The query string of the URL, as an object. */
    url: () => Object.fromEntries(new URLSearchParams(view.result.current.location.search)),
    /** A URL change the table did not make. A number steps through the history (-1 is Back). */
    navigate: (to: string | number, options?: NavigateOptions) =>
      act(() => {
        const go = view.result.current.navigate;
        if (typeof to === 'number') void go(to);
        else void go(to, options);
      }),
  };
}

/** Longer than the rest the hook takes before it writes the URL. */
async function rest() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

/** The parameters that have a value: what actually goes on the request. */
function sent(params: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

describe('useAnalyticsTable', () => {
  it('starts untouched: every row in the delivered order, the first chip, no sort', async () => {
    const view = setup(`${TAB}?period=3m`);

    expect(view.table().q).toBe('');
    expect(view.table().filter).toBe('all');
    expect(view.table().sort).toBeNull();
    expect(view.shown()).toEqual(DELIVERED);
    expect(view.table().total).toBe(5);
    expect(view.table().page).toBe(1);
    expect(view.table().limit).toBe(PAGE_SIZE);
    expect(sent(view.table().exportParams)).toEqual({ period: '3m' });

    // Nothing to say, so the URL is left as it was.
    await rest();
    expect(view.url()).toEqual({ period: '3m' });
  });

  it('reads q, filter, sort and dir from the URL', () => {
    const view = setup(`${TAB}?period=3m&q=net&filter=flagged&sort=cards&dir=desc`);

    expect(view.table().q).toBe('net');
    expect(view.table().filter).toBe('flagged');
    expect(view.table().sort).toEqual({ key: 'cards', dir: 'desc' });
    // "net" is in the owner of two routers; both are flagged; most cards first.
    expect(view.shown()).toEqual(['Souq Router', 'Market AP']);
    expect(view.table().total).toBe(2);
  });

  it('ignores what it does not know, and the URL then says what the table shows', async () => {
    const long = 'x'.repeat(SEARCH_MAX_LENGTH + 50);
    const view = setup(`${TAB}?period=3m&q=${long}&filter=secret&sort=note&dir=desc`);

    // An unknown chip is the first one; a column that cannot be sorted is no sort.
    expect(view.table().filter).toBe('all');
    expect(view.table().sort).toBeNull();
    // The search is cut to what the export endpoint accepts.
    expect(view.table().q).toBe('x'.repeat(SEARCH_MAX_LENGTH));
    await waitFor(() =>
      expect(view.url()).toEqual({ period: '3m', q: 'x'.repeat(SEARCH_MAX_LENGTH) }),
    );

    // A column the table does not have at all.
    expect(setup(`${TAB}?sort=password&dir=desc`).table().sort).toBeNull();
    // A direction with no column to go with.
    expect(setup(`${TAB}?dir=desc`).table().sort).toBeNull();
    // Any direction but "desc" is ascending.
    expect(setup(`${TAB}?sort=name&dir=up`).table().sort).toEqual({ key: 'name', dir: 'asc' });
    expect(setup(`${TAB}?sort=name`).table().sort).toEqual({ key: 'name', dir: 'asc' });
  });

  it('answers a change at once, and writes it to the URL after a short rest, in place', async () => {
    // The admin came from another page.
    const view = setup(['/users', `${TAB}?period=3m`]);

    act(() => view.table().setQ('nile'));
    // The table follows the keystroke; the URL does not, yet.
    expect(view.table().q).toBe('nile');
    expect(view.shown()).toEqual(['Cafe Nile Main', 'Cafe Nile Roof']);
    expect(view.url()).toEqual({ period: '3m' });

    // The period stays in the URL beside the search.
    await waitFor(() => expect(view.url()).toEqual({ period: '3m', q: 'nile' }));

    act(() => view.table().setFilter('flagged'));
    act(() => view.table().setSort({ key: 'cards', dir: 'desc' }));
    await waitFor(() =>
      expect(view.url()).toEqual({
        period: '3m',
        q: 'nile',
        filter: 'flagged',
        sort: 'cards',
        dir: 'desc',
      }),
    );

    // Written in place: Back leaves the page, it does not replay the choices.
    view.navigate(-1);
    await waitFor(() => expect(view.path()).toBe('/users'));
  });

  it('keeps a blank search and the first chip out of the URL and the export', async () => {
    const view = setup(TAB);

    // The search is kept as typed, and sent without the spaces around it.
    act(() => view.table().setQ('  Nile '));
    expect(view.table().q).toBe('  Nile ');
    expect(view.shown()).toEqual(['Cafe Nile Main', 'Cafe Nile Roof']);
    expect(sent(view.table().exportParams)).toEqual({ period: '3m', q: 'Nile' });
    await waitFor(() => expect(view.url()).toEqual({ q: 'Nile' }));

    // Nothing but spaces is no search.
    act(() => view.table().setQ('   '));
    expect(view.shown()).toEqual(DELIVERED);
    expect(sent(view.table().exportParams)).toEqual({ period: '3m' });
    await waitFor(() => expect(view.url()).toEqual({}));

    act(() => view.table().setFilter('flagged'));
    expect(sent(view.table().exportParams)).toEqual({ period: '3m', filter: 'flagged' });
    await waitFor(() => expect(view.url()).toEqual({ filter: 'flagged' }));

    // Back on the first chip: the default is not spelled out.
    act(() => view.table().setFilter('all'));
    expect(sent(view.table().exportParams)).toEqual({ period: '3m' });
    await waitFor(() => expect(view.url()).toEqual({}));
  });

  it('sorts by the column asked for, with rows that have no value last both ways', async () => {
    const view = setup(TAB);

    act(() => view.table().setSort({ key: 'cards', dir: 'asc' }));
    expect(view.table().sort).toEqual({ key: 'cards', dir: 'asc' });
    expect(view.shown()).toEqual([
      'Market AP',
      'Souq Router',
      'Cafe Nile Roof',
      'Cafe Nile Main',
      'New Shop Router',
    ]);
    await waitFor(() => expect(view.url()).toEqual({ sort: 'cards', dir: 'asc' }));

    act(() => view.table().setSort({ key: 'cards', dir: 'desc' }));
    expect(view.shown()).toEqual([
      'Cafe Nile Main',
      'Cafe Nile Roof',
      'Souq Router',
      'Market AP',
      'New Shop Router',
    ]);
    await waitFor(() => expect(view.url()).toEqual({ sort: 'cards', dir: 'desc' }));

    act(() => view.table().setSort({ key: 'name', dir: 'asc' }));
    expect(view.shown()).toEqual([
      'Cafe Nile Main',
      'Cafe Nile Roof',
      'Market AP',
      'New Shop Router',
      'Souq Router',
    ]);
  });

  it('counts on each chip the rows the search leaves, whichever chip is active', () => {
    const view = setup(TAB);
    expect(view.table().filterOptions).toEqual([
      { key: 'all', label: 'All', count: 5 },
      { key: 'flagged', label: 'Flagged', count: 2 },
    ]);

    act(() => view.table().setQ('router'));
    expect(view.table().filterOptions.map((option) => option.count)).toEqual([2, 1]);

    // Choosing a chip narrows the rows, not the counts.
    act(() => view.table().setFilter('flagged'));
    expect(view.shown()).toEqual(['Souq Router']);
    expect(view.table().total).toBe(1);
    expect(view.table().filterOptions.map((option) => option.count)).toEqual([2, 1]);

    act(() => view.table().setQ('nile'));
    expect(view.shown()).toEqual([]);
    expect(view.table().total).toBe(0);
    expect(view.table().filterOptions.map((option) => option.count)).toEqual([2, 0]);
  });

  it('pages the rows, and starts on page 1 again when the search, chip, sort or period changes', () => {
    const many: Row[] = Array.from({ length: 45 }, (_, i) => ({
      id: `r-${i + 1}`,
      name: `Router ${String(i + 1).padStart(2, '0')}`,
      owner: 'Atbara Net',
      cards: i,
      flagged: i < 30,
    }));
    const view = setup(TAB, { rows: many });

    expect(view.table().total).toBe(45);
    expect(view.shown()).toHaveLength(PAGE_SIZE);
    expect(view.shown()[0]).toBe('Router 01');

    act(() => view.table().setPage(3));
    expect(view.table().page).toBe(3);
    expect(view.shown()).toEqual(['Router 41', 'Router 42', 'Router 43', 'Router 44', 'Router 45']);

    // A search is another view of the table.
    act(() => view.table().setQ('Router 0'));
    expect(view.table().page).toBe(1);
    expect(view.table().total).toBe(9);
    expect(view.shown()).toHaveLength(9);

    // So is a chip.
    act(() => view.table().setQ('Router'));
    expect(view.table().total).toBe(45);
    act(() => view.table().setPage(2));
    expect(view.table().page).toBe(2);
    act(() => view.table().setFilter('flagged'));
    expect(view.table().page).toBe(1);
    expect(view.table().total).toBe(30);

    // So is a sort.
    act(() => view.table().setPage(2));
    expect(view.shown()[0]).toBe('Router 21');
    act(() => view.table().setSort({ key: 'cards', dir: 'desc' }));
    expect(view.table().page).toBe(1);
    expect(view.shown()[0]).toBe('Router 30');

    // And so is another period, which brings other rows.
    act(() => view.table().setPage(2));
    expect(view.table().page).toBe(2);
    view.rerender({ rows: many, period: { period: '12m' } });
    expect(view.table().page).toBe(1);
  });

  it('steps back to the last page when a refetch shortens the list under it', () => {
    const many: Row[] = Array.from({ length: 45 }, (_, i) => ({
      id: `r-${i + 1}`,
      name: `Router ${String(i + 1).padStart(2, '0')}`,
      owner: null,
      cards: i,
      flagged: false,
    }));
    const view = setup(TAB, { rows: many });
    act(() => view.table().setPage(3));
    expect(view.table().page).toBe(3);

    view.rerender({ rows: many.slice(0, 25), period: { period: '3m' } });
    expect(view.table().page).toBe(2);
    expect(view.shown()).toEqual(['Router 21', 'Router 22', 'Router 23', 'Router 24', 'Router 25']);

    view.rerender({ rows: [], period: { period: '3m' } });
    expect(view.table().page).toBe(1);
    expect(view.shown()).toEqual([]);
    expect(view.table().total).toBe(0);
  });

  it("drops the search, chip and sort when the tab's own link is opened", async () => {
    const view = setup(`${TAB}?period=3m&q=nile&filter=flagged&sort=cards&dir=desc`);
    expect(view.table().q).toBe('nile');

    // The page's tab link: the same tab, with nothing of the table in it.
    view.navigate(TAB);
    expect(view.table().q).toBe('');
    expect(view.table().filter).toBe('all');
    expect(view.table().sort).toBeNull();
    expect(view.shown()).toEqual(DELIVERED);
    expect(sent(view.table().exportParams)).toEqual({ period: '3m' });

    // And it does not write the old choices back.
    await rest();
    expect(view.url()).toEqual({});
  });

  it('takes over a view a link carries, even over a choice still on its way to the URL', async () => {
    const view = setup(`${TAB}?period=3m`);
    act(() => view.table().setQ('nile'));

    view.navigate(`${TAB}?period=3m&filter=flagged&sort=name&dir=desc`);
    expect(view.table().q).toBe('');
    expect(view.table().filter).toBe('flagged');
    expect(view.table().sort).toEqual({ key: 'name', dir: 'desc' });
    expect(view.shown()).toEqual(['Souq Router', 'Market AP']);

    // The link's URL is left alone.
    await rest();
    expect(view.url()).toEqual({ period: '3m', filter: 'flagged', sort: 'name', dir: 'desc' });
  });

  it('keeps the search, chip and sort through a period change, written or still on their way', async () => {
    const view = setup(`${TAB}?period=30d`);

    // Typed, and not in the URL yet when the period picker rewrites the period.
    act(() => view.table().setQ('nile'));
    act(() => view.table().setSort({ key: 'cards', dir: 'asc' }));
    view.navigate(`${TAB}?period=3m`, { replace: true });
    expect(view.table().q).toBe('nile');
    expect(view.table().sort).toEqual({ key: 'cards', dir: 'asc' });
    await waitFor(() =>
      expect(view.url()).toEqual({ period: '3m', q: 'nile', sort: 'cards', dir: 'asc' }),
    );

    // Already in the URL: the picker changes the period and leaves the rest.
    view.navigate(`${TAB}?period=12m&q=nile&sort=cards&dir=asc`, { replace: true });
    expect(view.table().q).toBe('nile');
    expect(view.table().sort).toEqual({ key: 'cards', dir: 'asc' });
    expect(view.shown()).toEqual(['Cafe Nile Roof', 'Cafe Nile Main']);
    await rest();
    expect(view.url()).toEqual({ period: '12m', q: 'nile', sort: 'cards', dir: 'asc' });
  });

  it('does not let its own write to the URL undo what was typed since', async () => {
    const view = setup(TAB);
    act(() => view.table().setQ('ni'));

    // The write of the keystroke before lands only now. It carries the table's mark.
    view.navigate(`${TAB}?q=n`, { replace: true, state: { analyticsTable: true } });
    expect(view.table().q).toBe('ni');
    expect(view.shown()).toEqual(['Cafe Nile Main', 'Cafe Nile Roof']);
    await waitFor(() => expect(view.url()).toEqual({ q: 'ni' }));

    // The same change without the mark is someone else's, and is taken over.
    view.navigate(`${TAB}?q=souq`, { replace: true });
    expect(view.table().q).toBe('souq');
    expect(view.shown()).toEqual(['Souq Router']);
  });

  it('follows the Back button to an older view, also onto a URL it wrote itself', async () => {
    const view = setup(TAB);

    // The table writes its search over the entry it is on.
    act(() => view.table().setQ('nile'));
    await waitFor(() => expect(view.url()).toEqual({ q: 'nile' }));

    // A link opens another view on a new entry.
    view.navigate(`${TAB}?q=souq&filter=flagged`);
    expect(view.table().q).toBe('souq');
    expect(view.table().filter).toBe('flagged');

    // Back lands on the entry that carries the table's mark: it is still not
    // the table's doing, so the older view is shown.
    view.navigate(-1);
    await waitFor(() => expect(view.table().q).toBe('nile'));
    expect(view.table().filter).toBe('all');
    expect(view.shown()).toEqual(['Cafe Nile Main', 'Cafe Nile Roof']);
    expect(view.url()).toEqual({ q: 'nile' });
  });

  it('hands the export the period and the choices on screen, before the URL has them', () => {
    const view = setup(`${TAB}?period=3m&q=net&filter=flagged&sort=cards&dir=desc`);
    expect(sent(view.table().exportParams)).toEqual({
      period: '3m',
      q: 'net',
      filter: 'flagged',
      sort: 'cards',
      dir: 'desc',
    });

    // A custom range travels as its two days.
    const custom = setup(TAB, { period: { from: '2026-11-01', to: '2026-11-10' } });
    expect(sent(custom.table().exportParams)).toEqual({ from: '2026-11-01', to: '2026-11-10' });

    act(() => custom.table().setQ(' roof '));
    act(() => custom.table().setSort({ key: 'name', dir: 'asc' }));
    expect(custom.url()).toEqual({});
    expect(sent(custom.table().exportParams)).toEqual({
      from: '2026-11-01',
      to: '2026-11-10',
      q: 'roof',
      sort: 'name',
      dir: 'asc',
    });
  });
});
