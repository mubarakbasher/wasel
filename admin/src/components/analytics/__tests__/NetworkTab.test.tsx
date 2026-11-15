import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

// Mock the axios wrapper: answer the network endpoint and capture the calls.
vi.mock('../../../lib/api', () => ({
  default: { get: vi.fn() },
}));

import api from '../../../lib/api';
import { ToastProvider } from '../../../hooks/useToast';
import type { NetworkAnalytics } from '../../../lib/analytics';
import type { PeriodQuery } from '../../../lib/period';
import {
  analyticsGet,
  emptyMetaFixture,
  emptyNetworkFixture,
  metaFixture,
  networkFixture,
  staleNetworkFixture,
} from '../../../tests/analyticsFixtures';
import NetworkTab from '../NetworkTab';

const mockGet = api.get as unknown as Mock;

/** Prints the router location so a test can read what the tab wrote to the URL. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname + search}</output>;
}

function tree(period: PeriodQuery, url: string, queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/analytics/network" element={<NetworkTab period={period} />} />
          </Routes>
          {/* What the page's own tab link does: the same tab, without its table state. */}
          <Link to="/analytics/network">Open the tab again</Link>
          <LocationProbe />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderTab(period: PeriodQuery = { period: '3m' }, url = '/analytics/network') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const view = render(tree(period, url, queryClient));
  return {
    ...view,
    setPeriod: (next: PeriodQuery) => view.rerender(tree(next, url, queryClient)),
  };
}

/** Renders the tab and waits for its figures. */
async function renderLoaded(period?: PeriodQuery, url?: string) {
  const view = renderTab(period, url);
  await screen.findByText('Routers online now');
  return view;
}

function urlParams(): Record<string, string> {
  const text = screen.getByTestId('location').textContent ?? '';
  return Object.fromEntries(new URLSearchParams(text.split('?')[1] ?? ''));
}

/** The text column of a stat card: its title, value and the line under them. */
function card(title: string): HTMLElement {
  return screen.getByText(title).parentElement as HTMLElement;
}

/** The hidden data table of a chart, as rows of cell texts. */
function chartTable(name: string): string[][] {
  const table = screen.getByRole('table', { name: `${name} (data table)` });
  return Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
    Array.from(tr.children).map((cell) => cell.textContent ?? ''),
  );
}

function routersTable(): HTMLElement {
  return screen.getByRole('columnheader', { name: /Longest outage/ }).closest('table') as HTMLElement;
}

function routerRows(): HTMLElement[] {
  return within(routersTable()).getAllByRole('row').slice(1);
}

const ROUTER_NAMES = ['Souq Router', 'Market AP', 'Cafe Nile Main', 'Cafe Nile Roof', 'New Shop Router'];

/** The routers on screen, top to bottom. */
function shownRouters(): string[] {
  return routerRows().map((row) => {
    const first = row.querySelector('td')?.textContent ?? '';
    return ROUTER_NAMES.find((name) => first.includes(name)) ?? first;
  });
}

function rowOf(router: string): HTMLElement {
  return within(routersTable()).getByText(router).closest('tr') as HTMLElement;
}

function cellsOf(router: string): string[] {
  return Array.from(rowOf(router).querySelectorAll('td')).map((td) => td.textContent ?? '');
}

function chips(): HTMLElement {
  return screen.getByRole('group', { name: 'Filter routers' });
}

function searchBox(): HTMLElement {
  return screen.getByRole('searchbox', { name: 'Search routers' });
}

function sortButton(header: RegExp): HTMLElement {
  return within(screen.getByRole('columnheader', { name: header })).getByRole('button');
}

/** Every attribute and every piece of text the tab put in the DOM. */
function domDump(container: HTMLElement): string {
  const attrs = Array.from(container.querySelectorAll('*')).flatMap((el) =>
    Array.from(el.attributes).map((a) => `${a.name}=${a.value}`),
  );
  return [...attrs, container.textContent ?? ''].join('\n');
}

describe('NetworkTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation(analyticsGet());
  });

  afterEach(() => {
    // Undo the anchor-click spy of the export test.
    vi.restoreAllMocks();
  });

  it('renders the four cards, three charts, the routers table and card types', async () => {
    const { container } = await renderLoaded();

    expect(mockGet).toHaveBeenCalledWith('/admin/analytics/network', { params: { period: '3m' } });
    expect(screen.getByText('Figures as of 15 Nov 2026, 12:20')).toBeInTheDocument();

    // --- the four cards ---
    const online = card('Routers online now');
    expect(within(online).getByText('2 of 5')).toBeInTheDocument();
    expect(online).toHaveTextContent('Uptime 89.8%');
    expect(online).toHaveTextContent('1 never connected');
    expect(online).not.toHaveTextContent('not seen since launch');

    const dropping = card('Keep dropping');
    expect(within(dropping).getByText('2')).toBeInTheDocument();
    expect(dropping).toHaveTextContent('5+ drops in the last 7 days');

    const used = card('Cards used');
    expect(within(used).getByText('980')).toBeInTheDocument();
    expect(used).toHaveTextContent('of 1,020 created');

    const sales = card('Sales value');
    expect(within(sales).getByText('SDG 640,000')).toBeInTheDocument();
    expect(sales).toHaveTextContent('Of used cards');
    expect(sales).toHaveTextContent("Operators' own sales, not Wasel income");

    // --- the three charts ---
    expect(screen.getByRole('img', { name: 'Cards created and used per day' })).toBeInTheDocument();
    expect(container.querySelectorAll('path[data-mark="line"]')).toHaveLength(2);
    expect(chartTable('Cards created and used per day')).toEqual([
      ['13 Nov', '420', '380'],
      ['14 Nov', '0', '410'],
      ['15 Nov', '600', '190'],
    ]);

    expect(screen.getByRole('img', { name: 'Busiest hours' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-mark="cell"]')).toHaveLength(7 * 24);

    expect(screen.getByRole('img', { name: 'Data used per day' })).toBeInTheDocument();
    expect(container.querySelectorAll('path[data-mark="bar"]')).toHaveLength(3);
    expect(chartTable('Data used per day')).toEqual([
      ['13 Nov', '21 GB'],
      ['14 Nov', '24 GB'],
      ['15 Nov', '9 GB'],
    ]);

    // --- the routers table: eight columns, in the order the API sent ---
    const headers = within(routersTable()).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual([
      'Router',
      'Operator',
      'Uptime',
      'Drops',
      'Longest outage',
      'Sessions',
      'Data',
      'Now',
    ]);
    expect(shownRouters()).toEqual(ROUTER_NAMES);
    expect(cellsOf('Souq Router').slice(1)).toEqual([
      'Atbara Net',
      '71.5%',
      '7',
      '9 h',
      '310',
      '12 GB',
      'Online',
    ]);
    expect(within(rowOf('Souq Router')).getByRole('link', { name: 'Atbara Net' })).toHaveAttribute(
      'href',
      '/users/u-atbara',
    );
    expect(within(rowOf('Market AP')).getByLabelText('Status: offline')).toBeInTheDocument();
    expect(within(rowOf('Cafe Nile Roof')).getByLabelText('Status: degraded')).toBeInTheDocument();
    // No outage at all prints a dash, not "0 s".
    expect(cellsOf('Cafe Nile Roof')[4]).toBe('—');
    expect(screen.getByText('Showing 1 to 5 of 5 results')).toBeInTheDocument();

    // --- card types ---
    const byPrice = screen.getByRole('img', { name: 'Cards used by price' });
    expect(within(byPrice).getByText('SDG 500')).toBeInTheDocument();
    expect(within(byPrice).getByText('SDG 1,000')).toBeInTheDocument();
    expect(within(byPrice).getByText('No price')).toBeInTheDocument();
    expect(chartTable('Cards used by price')[0]).toEqual(['SDG 500', '600', '61%']);

    const byKind = screen.getByRole('img', { name: 'Cards used by kind' });
    expect(within(byKind).getByText('Time-limited')).toBeInTheDocument();
    expect(within(byKind).getByText('Data-limited')).toBeInTheDocument();
    expect(within(byKind).getByText('No limit')).toBeInTheDocument();

    expect(screen.getByText(/Days and hours are Khartoum time/)).toBeInTheDocument();
  });

  it('shows "Status unknown" and no online count when monitorStale is true', async () => {
    // As the server answers while the monitor is silent: no online count, and
    // every router's status already "unknown".
    mockGet.mockImplementation(analyticsGet({ network: staleNetworkFixture() }));
    await renderLoaded();

    const online = card('Routers online now');
    expect(within(online).getByText('Status unknown')).toBeInTheDocument();
    // Neither the old count nor the zero the server sends in its place.
    expect(within(online).getByText('—')).toBeInTheDocument();
    expect(online).not.toHaveTextContent('of 5');
    expect(screen.queryByText('2 of 5')).not.toBeInTheDocument();
    // Uptime is history, not live status: it stays.
    expect(online).toHaveTextContent('Uptime 89.8%');
    expect(
      screen.getByText(
        'Live router status is unknown: the router monitor has not reported for over 3 minutes',
      ),
    ).toBeInTheDocument();

    const table = routersTable();
    expect(within(table).getAllByLabelText('Status: unknown')).toHaveLength(5);
    expect(within(table).queryByLabelText('Status: online')).not.toBeInTheDocument();
    expect(within(table).queryByLabelText('Status: offline')).not.toBeInTheDocument();
    // No router is known to be offline either; the history flags are untouched.
    expect(within(chips()).getByRole('button', { name: /^Offline now/ })).toHaveAccessibleName(
      'Offline now 0',
    );
    expect(within(chips()).getByRole('button', { name: /^Dropping/ })).toHaveAccessibleName(
      'Dropping 2',
    );
  });

  it('the Now column shows each router with the status the server sent', async () => {
    // The table does not second-guess a row: one router of unknown status
    // among live ones reads "Unknown", and the others keep their own.
    const network = networkFixture();
    network.routers[2].status = 'unknown';
    mockGet.mockImplementation(analyticsGet({ network }));
    await renderLoaded();

    expect(cellsOf('Cafe Nile Main')[7]).toBe('Unknown');
    expect(cellsOf('Souq Router')[7]).toBe('Online');
    expect(cellsOf('Market AP')[7]).toBe('Offline');
    expect(cellsOf('Cafe Nile Roof')[7]).toBe('Degraded');
    expect(within(routersTable()).getAllByLabelText('Status: unknown')).toHaveLength(1);
    expect(within(card('Routers online now')).getByText('2 of 5')).toBeInTheDocument();
  });

  it('shortens a sales value the card would cut off, and prints the exact amount under it', async () => {
    const network = networkFixture();
    network.cards.salesValue = 21_906_000;
    mockGet.mockImplementation(analyticsGet({ network }));
    const first = await renderLoaded();

    const sales = card('Sales value');
    expect(within(sales).getByText('SDG 21.9M')).toBeInTheDocument();
    expect(sales).toHaveTextContent('SDG 21,906,000 of used cards');
    first.unmount();

    // Just under the limit the exact amount still fits on the card.
    network.cards.salesValue = 9_999_999;
    mockGet.mockImplementation(analyticsGet({ network }));
    await renderLoaded();
    expect(within(card('Sales value')).getByText('SDG 9,999,999')).toBeInTheDocument();
  });

  it('shows "—" for uptime when uptimePct is null', async () => {
    const network = networkFixture();
    network.cards.uptimePct = null;
    mockGet.mockImplementation(analyticsGet({ network }));
    await renderLoaded();

    expect(card('Routers online now')).toHaveTextContent('Uptime —');
    // The router that was never seen online has no uptime figure either.
    expect(cellsOf('New Shop Router')[2]).toBe('—');
    expect(cellsOf('Cafe Nile Roof')[2]).toBe('100.0%');
  });

  it('the Dropping chip shows only rows flagged dropping', async () => {
    const user = userEvent.setup();
    await renderLoaded();

    const all = within(chips()).getByRole('button', { name: /^All/ });
    const dropping = within(chips()).getByRole('button', { name: /^Dropping/ });
    const offline = within(chips()).getByRole('button', { name: /^Offline now/ });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAccessibleName('All 5');
    expect(dropping).toHaveAccessibleName('Dropping 2');
    expect(offline).toHaveAccessibleName('Offline now 2');

    await user.click(dropping);
    expect(shownRouters()).toEqual(['Souq Router', 'Market AP']);
    expect(dropping).toHaveAttribute('aria-pressed', 'true');
    // The URL follows after a short rest.
    await waitFor(() => expect(urlParams()).toEqual({ filter: 'dropping' }));

    await user.click(offline);
    expect(shownRouters()).toEqual(['Market AP', 'New Shop Router']);
    await waitFor(() => expect(urlParams()).toEqual({ filter: 'offline' }));

    await user.click(all);
    expect(shownRouters()).toEqual(ROUTER_NAMES);
    await waitFor(() => expect(urlParams()).toEqual({}));
  });

  it('shows the launch notice when routerHistoryStart is null', async () => {
    mockGet.mockImplementation(analyticsGet({ meta: metaFixture({ routerHistoryStart: null }) }));
    await renderLoaded();

    expect(screen.getByText('Router uptime starts recording at launch')).toBeInTheDocument();
    expect(screen.queryByText(/Router history began on/)).not.toBeInTheDocument();
  });

  it('shows the router-history notice only for the first 30 days', async () => {
    // Began 10 Nov, figures up to 15 Nov: day 6.
    const first = await renderLoaded();
    expect(screen.getByText('Router history began on 10 Nov 2026')).toBeInTheDocument();
    expect(screen.queryByText('Router uptime starts recording at launch')).not.toBeInTheDocument();
    first.unmount();

    // Day 30 still shows it, day 31 does not.
    mockGet.mockImplementation(
      analyticsGet({ meta: metaFixture({ routerHistoryStart: '2026-10-17' }) }),
    );
    const second = await renderLoaded();
    expect(screen.getByText('Router history began on 17 Oct 2026')).toBeInTheDocument();
    second.unmount();

    mockGet.mockImplementation(
      analyticsGet({ meta: metaFixture({ routerHistoryStart: '2026-10-16' }) }),
    );
    await renderLoaded();
    expect(screen.queryByText(/Router history began on/)).not.toBeInTheDocument();
    expect(screen.queryByText('Router uptime starts recording at launch')).not.toBeInTheDocument();
  });

  it('shows the use-history notice when the range starts before usageHistoryStart', async () => {
    // The fixture range starts on 1 Sep; use history starts on 20 Oct.
    const first = await renderLoaded();
    expect(screen.getByText('Use history begins on 20 Oct 2026')).toBeInTheDocument();
    first.unmount();

    mockGet.mockImplementation(
      analyticsGet({ meta: metaFixture({ range: { from: '2026-10-20', to: '2026-11-15' } }) }),
    );
    await renderLoaded();
    expect(screen.queryByText(/Use history begins on/)).not.toBeInTheDocument();
  });

  it('leaves a gap in the Used line for days before the use history starts', async () => {
    mockGet.mockImplementation(
      analyticsGet({ meta: metaFixture({ usageHistoryStart: '2026-11-14' }) }),
    );
    await renderLoaded();

    // 13 Nov is before the start: "0 used" would be a claim nobody recorded.
    expect(chartTable('Cards created and used per day')).toEqual([
      ['13 Nov', '420', 'No data'],
      ['14 Nov', '0', '410'],
      ['15 Nov', '600', '190'],
    ]);
  });

  it('shows the no-price notice only when some used cards have no price', async () => {
    const first = await renderLoaded();
    expect(screen.getByText('Sales value excludes 40 cards with no price')).toBeInTheDocument();
    first.unmount();

    const one = networkFixture();
    one.cards.unpricedUsed = 1;
    mockGet.mockImplementation(analyticsGet({ network: one }));
    const second = await renderLoaded();
    expect(screen.getByText('Sales value excludes 1 card with no price')).toBeInTheDocument();
    second.unmount();

    const none = networkFixture();
    none.cards.unpricedUsed = 0;
    mockGet.mockImplementation(analyticsGet({ network: none }));
    await renderLoaded();
    expect(screen.queryByText(/Sales value excludes/)).not.toBeInTheDocument();
  });

  it('renders empty states with no NaN when every array is empty', async () => {
    mockGet.mockImplementation(
      analyticsGet({ network: emptyNetworkFixture(), meta: emptyMetaFixture() }),
    );
    const { container } = await renderLoaded();

    const online = card('Routers online now');
    expect(within(online).getByText('0 of 0')).toBeInTheDocument();
    expect(online).toHaveTextContent('Uptime —');
    expect(within(card('Keep dropping')).getByText('0')).toBeInTheDocument();
    expect(within(card('Cards used')).getByText('0')).toBeInTheDocument();
    expect(card('Cards used')).toHaveTextContent('of 0 created');
    expect(within(card('Sales value')).getByText('SDG 0')).toBeInTheDocument();
    expect(card('Sales value')).toHaveTextContent('Of used cards');

    // The three charts and the two card-type lists each show their empty block.
    expect(container.querySelectorAll('[data-chart-empty]')).toHaveLength(5);
    expect(screen.getByText('No cards in this period')).toBeInTheDocument();
    expect(screen.getByText('No sessions in this period')).toBeInTheDocument();
    expect(screen.getByText('No data use in this period')).toBeInTheDocument();
    expect(screen.getAllByText('No cards used in this period')).toHaveLength(2);
    expect(container.querySelector('[data-mark]')).toBeNull();

    expect(screen.getByText('No routers yet.')).toBeInTheDocument();
    expect(within(chips()).getByRole('button', { name: /^All/ })).toHaveAccessibleName('All 0');

    // The summaries never ran: an amber "No figures yet", and the launch notice.
    expect(screen.getByText('No figures yet').closest('[data-stale]')).toHaveAttribute(
      'data-stale',
      'true',
    );
    expect(screen.getByText('Router uptime starts recording at launch')).toBeInTheDocument();
    expect(screen.queryByText(/Sales value excludes/)).not.toBeInTheDocument();

    expect(domDump(container)).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('puts the busiest hours on a Saturday-to-Friday grid, 00:00 to 23:00', async () => {
    const { container } = await renderLoaded();

    const table = screen.getByRole('table', { name: 'Busiest hours (data table)' });
    const hours = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(hours).toHaveLength(24);
    expect(hours[0]).toBe('00:00');
    expect(hours[23]).toBe('23:00');

    const rows = chartTable('Busiest hours');
    expect(rows.map((row) => row[0])).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    // dow 6 = Saturday is the first row, dow 0 = Sunday the second, dow 5 = Friday the last.
    expect(rows[0][1 + 21]).toBe('95 sessions');
    expect(rows[1][1 + 9]).toBe('12 sessions');
    expect(rows[6][1 + 20]).toBe('140 sessions');
    expect(rows[6][1 + 21]).toBe('180 sessions');
    expect(rows[2][1 + 21]).toBe('0 sessions');

    // The busiest hour (Friday 21:00) is the darkest cell.
    const cells = container.querySelectorAll('[data-mark="cell"]');
    expect(cells[6 * 24 + 21].getAttribute('data-step')).toBe('5');
    expect(cells[0].getAttribute('data-step')).toBe('0');
  });

  it('draws data per day on one byte unit, with round ticks', async () => {
    const { container } = await renderLoaded();

    const axis = container.querySelector('[data-chart="bar"] [data-chart-axis="y"]') as HTMLElement;
    const ticks = Array.from(axis.querySelectorAll('span')).map((span) => span.textContent);
    expect(ticks).toEqual(['0 GB', '10 GB', '20 GB', '30 GB']);
  });

  it('starts in the delivered order and sorts when a header is clicked', async () => {
    const user = userEvent.setup();
    await renderLoaded();

    expect(shownRouters()).toEqual(ROUTER_NAMES);
    for (const header of within(routersTable()).getAllByRole('columnheader')) {
      expect(header).not.toHaveAttribute('aria-sort');
    }
    expect(screen.getByRole('heading', { name: /Routers/ })).toHaveTextContent('worst first');

    await user.click(sortButton(/Sessions/));
    expect(shownRouters()).toEqual([
      'New Shop Router',
      'Market AP',
      'Souq Router',
      'Cafe Nile Roof',
      'Cafe Nile Main',
    ]);
    expect(screen.getByRole('columnheader', { name: /Sessions/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(screen.getByRole('heading', { name: /Routers/ })).not.toHaveTextContent('worst first');
    // The URL follows after a short rest.
    await waitFor(() => expect(urlParams()).toEqual({ sort: 'sessions', dir: 'asc' }));

    await user.click(sortButton(/Sessions/));
    expect(shownRouters()[0]).toBe('Cafe Nile Main');
    await waitFor(() => expect(urlParams()).toEqual({ sort: 'sessions', dir: 'desc' }));

    // A router with no uptime figure stays last in both directions.
    await user.click(sortButton(/Uptime/));
    expect(shownRouters()).toEqual(ROUTER_NAMES);
    await user.click(sortButton(/Uptime/));
    expect(shownRouters()).toEqual([
      'Cafe Nile Roof',
      'Cafe Nile Main',
      'Market AP',
      'Souq Router',
      'New Shop Router',
    ]);
    await waitFor(() => expect(urlParams()).toEqual({ sort: 'uptimePct', dir: 'desc' }));
  });

  it('search matches the router name and the operator', async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.type(searchBox(), 'nile');
    expect(searchBox()).toHaveValue('nile');
    expect(shownRouters()).toEqual(['Cafe Nile Main', 'Cafe Nile Roof']);
    await waitFor(() => expect(urlParams()).toEqual({ q: 'nile' }));
    // The chips count what the search left.
    expect(within(chips()).getByRole('button', { name: /^All/ })).toHaveAccessibleName('All 2');
    expect(within(chips()).getByRole('button', { name: /^Dropping/ })).toHaveAccessibleName(
      'Dropping 0',
    );

    // The operator's name, in any case, with stray spaces.
    await user.clear(searchBox());
    await user.type(searchBox(), '  ATBARA ');
    expect(shownRouters()).toEqual(['Souq Router', 'Market AP']);

    await user.clear(searchBox());
    await user.type(searchBox(), 'zzz');
    expect(screen.getByText('No routers match this search or filter.')).toBeInTheDocument();

    await user.clear(searchBox());
    expect(shownRouters()).toEqual(ROUTER_NAMES);
    await waitFor(() => expect(urlParams()).toEqual({}));
  });

  it('reads the search, chip and sort from the URL, and ignores values it does not know', async () => {
    const first = await renderLoaded(
      { period: '3m' },
      '/analytics/network?period=3m&q=net&filter=dropping&sort=sessions&dir=desc',
    );
    expect(searchBox()).toHaveValue('net');
    expect(within(chips()).getByRole('button', { name: /^Dropping/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('columnheader', { name: /Sessions/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(shownRouters()).toEqual(['Souq Router', 'Market AP']);
    first.unmount();

    await renderLoaded({ period: '3m' }, '/analytics/network?filter=secret&sort=password&dir=up');
    expect(within(chips()).getByRole('button', { name: /^All/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(shownRouters()).toEqual(ROUTER_NAMES);
    for (const header of within(routersTable()).getAllByRole('columnheader')) {
      expect(header).not.toHaveAttribute('aria-sort');
    }
  });

  it('opening the tab again clears the search, chip and sort', async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.type(searchBox(), 'nile');
    await user.click(sortButton(/Sessions/));
    expect(shownRouters()).toEqual(['Cafe Nile Roof', 'Cafe Nile Main']);
    await waitFor(() => expect(urlParams()).toEqual({ q: 'nile', sort: 'sessions', dir: 'asc' }));

    await user.click(screen.getByRole('link', { name: 'Open the tab again' }));
    await waitFor(() => expect(shownRouters()).toEqual(ROUTER_NAMES));
    expect(searchBox()).toHaveValue('');
    expect(urlParams()).toEqual({});
    for (const header of within(routersTable()).getAllByRole('columnheader')) {
      expect(header).not.toHaveAttribute('aria-sort');
    }
  });

  it('a period change keeps the search, chip and sort', async () => {
    const user = userEvent.setup();
    const view = await renderLoaded({ period: '30d' });

    await user.type(searchBox(), 'net');
    await user.click(within(chips()).getByRole('button', { name: /^Dropping/ }));
    await user.click(sortButton(/Sessions/));
    expect(shownRouters()).toEqual(['Market AP', 'Souq Router']);

    view.setPeriod({ period: '3m' });
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/network', {
        params: { period: '3m' },
      }),
    );
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(searchBox()).toHaveValue('net');
    expect(shownRouters()).toEqual(['Market AP', 'Souq Router']);
    await waitFor(() =>
      expect(urlParams()).toEqual({ q: 'net', filter: 'dropping', sort: 'sessions', dir: 'asc' }),
    );
  });

  it('pages the routers 20 at a time and returns to page 1 when the rows change', async () => {
    const user = userEvent.setup();
    const network = networkFixture();
    const base = network.routers[2];
    network.routers = Array.from({ length: 25 }, (_, i) => ({
      ...base,
      routerId: `r-${i + 1}`,
      router: `Router ${String(i + 1).padStart(2, '0')}`,
    }));
    mockGet.mockImplementation(analyticsGet({ network }));
    await renderLoaded();

    expect(routerRows()).toHaveLength(20);
    expect(screen.getByText('Showing 1 to 20 of 25 results')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(routerRows()).toHaveLength(5);
    expect(screen.getByText('Showing 21 to 25 of 25 results')).toBeInTheDocument();

    await user.type(searchBox(), 'Router 0');
    expect(routerRows()).toHaveLength(9);
    expect(screen.getByText('Showing 1 to 9 of 9 results')).toBeInTheDocument();
  });

  it('the export button carries the period, q, filter, sort and dir', async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const answer = analyticsGet();
    mockGet.mockImplementation(async (url: string) =>
      url.endsWith('/export') ? { data: new Blob(['router']), headers: {} } : answer(url),
    );

    // Nothing chosen: only the period goes, so the file comes in the delivered order.
    const first = await renderLoaded({ from: '2026-11-01', to: '2026-11-10' });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/network/routers/export', {
        params: { from: '2026-11-01', to: '2026-11-10' },
        responseType: 'blob',
      }),
    );
    first.unmount();

    await renderLoaded({ period: '3m' });
    await user.type(searchBox(), 'net');
    await user.click(within(chips()).getByRole('button', { name: /^Dropping/ }));
    await user.click(sortButton(/Drops/));
    await user.click(sortButton(/Drops/));
    await waitFor(() => expect(urlParams()).toMatchObject({ sort: 'drops', dir: 'desc' }));

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/network/routers/export', {
        params: { period: '3m', q: 'net', filter: 'dropping', sort: 'drops', dir: 'desc' },
        responseType: 'blob',
      }),
    );
  });

  it('shows a skeleton while the first figures load', () => {
    mockGet.mockImplementation(() => new Promise(() => {}));
    renderTab();

    expect(
      screen.getByRole('status', { name: 'Loading network and card figures' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Routers online now')).not.toBeInTheDocument();
  });

  it('keeps the previous figures on screen, dimmed, while a new period loads', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next: NetworkAnalytics = networkFixture();
    next.cards.routersOnline = 4;
    const answer = analyticsGet();
    const later = analyticsGet({ network: next });
    mockGet.mockImplementation(async (url: string, config?: { params?: { period?: string } }) => {
      if (config?.params?.period !== '12m') return answer(url);
      await gate;
      return later(url);
    });

    const view = await renderLoaded({ period: '3m' });
    expect(screen.getByText('2 of 5')).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();

    view.setPeriod({ period: '12m' });
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/network', {
        params: { period: '12m' },
      }),
    );
    const busy = document.querySelector('[aria-busy="true"]') as HTMLElement;
    expect(busy).not.toBeNull();
    expect(busy).toHaveClass('opacity-60');
    expect(within(busy).getByText('2 of 5')).toBeInTheDocument();
    // No skeleton flash: the old figures hold the layout.
    expect(
      screen.queryByRole('status', { name: 'Loading network and card figures' }),
    ).not.toBeInTheDocument();

    release();
    expect(await screen.findByText('4 of 5')).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('shows ErrorPanel and refetches on retry', async () => {
    const user = userEvent.setup();
    mockGet.mockRejectedValueOnce({
      response: { data: { error: { message: 'Analytics is not ready' } } },
    });
    renderTab();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to load data');
    expect(alert).toHaveTextContent('Analytics is not ready');
    expect(screen.queryByText('Routers online now')).not.toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Routers online now')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
