import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, useLocation, useSearchParams } from 'react-router-dom';

// Mock the axios wrapper: answer the analytics endpoints and capture the calls.
vi.mock('../../../lib/api', () => ({
  default: { get: vi.fn() },
}));

import api from '../../../lib/api';
import { ToastProvider } from '../../../hooks/useToast';
import type { OperatorRow } from '../../../lib/analytics';
import type { PeriodQuery } from '../../../lib/period';
import {
  analyticsGet,
  analyticsResponse,
  emptyMetaFixture,
  emptyOperatorsFixture,
  metaFixture,
  operatorsFixture,
  type AnalyticsGetOverrides,
} from '../../../tests/analyticsFixtures';
import OperatorsTab from '../OperatorsTab';

const mockGet = api.get as unknown as Mock;

const EXPORT_PATH = '/admin/analytics/operators/export';

/** The analytics fixtures, plus a CSV answer for the export. */
function apiGet(overrides: AnalyticsGetOverrides = {}) {
  const analytics = analyticsGet(overrides);
  return async (url: string) => {
    if (url === EXPORT_PATH) return { data: new Blob(['Operator']), headers: {} };
    return analytics(url);
  };
}

/** Prints the router location so a test can read the query string. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname + search}</output>;
}

function urlParams(): Record<string, string> {
  const text = screen.getByTestId('location').textContent ?? '';
  return Object.fromEntries(new URLSearchParams(text.split('?')[1] ?? ''));
}

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/**
 * What the page shell does to the URL around the tab: the tab's own link drops
 * the table state, any link may carry one, and the period picker replaces the
 * period and leaves the rest alone.
 */
function Shell() {
  const [, setSearchParams] = useSearchParams();
  return (
    <>
      <Link to="/analytics/operators?period=30d">Operators tab</Link>
      <Link to="/analytics/operators?period=30d&filter=near-limit&sort=cardsUsed&dir=desc">
        Near limit view
      </Link>
      <button
        type="button"
        onClick={() =>
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.set('period', '12m');
              return next;
            },
            { replace: true },
          )
        }
      >
        Period 12m
      </button>
    </>
  );
}

function tree(client: QueryClient, period: PeriodQuery, search: string, shell = false) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/analytics/operators${search}`]}>
          {shell && <Shell />}
          <OperatorsTab period={period} />
          <LocationProbe />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderTab(period: PeriodQuery = { period: '30d' }, search = '', shell = false) {
  return render(tree(newClient(), period, search, shell));
}

/** Operator names in the order the table shows them. */
function operatorOrder(): string[] {
  const table = screen.queryByRole('table');
  if (!table) return [];
  return within(table)
    .getAllByRole('link')
    .map((link) => link.textContent ?? '');
}

function rowOf(operator: string): HTMLElement {
  return screen.getByRole('link', { name: operator }).closest('tr') as HTMLElement;
}

function cellsOf(operator: string): string[] {
  return within(rowOf(operator))
    .getAllByRole('cell')
    .map((cell) => cell.textContent ?? '');
}

/** One summary card as text: its value, and the line under it. */
function card(title: string): { value: string; sub: string } {
  const totals = screen.getByRole('group', { name: 'Operator totals' });
  const [, value, sub] = Array.from(
    (within(totals).getByText(title).parentElement as HTMLElement).children,
  );
  return { value: value?.textContent ?? '', sub: sub?.textContent ?? '' };
}

/** A filter chip by its label; its name also carries the count of rows it keeps. */
function chip(label: string): HTMLElement {
  return within(screen.getByRole('group', { name: 'Filter operators' })).getByRole('button', {
    name: new RegExp(`^${label} [\\d,]+$`),
  });
}

function chipNames(): string[] {
  return within(screen.getByRole('group', { name: 'Filter operators' }))
    .getAllByRole('button')
    .map((button) => button.textContent ?? '');
}

function searchBox(): HTMLElement {
  return screen.getByRole('searchbox', { name: 'Search operators' });
}

async function loaded() {
  await screen.findByRole('link', { name: 'Cafe Nile' });
}

describe('OperatorsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation(apiGet());
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('renders the four cards and one row per operator', async () => {
    renderTab();
    await loaded();

    // One request for the whole tab, with the period it was given.
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/admin/analytics/operators', {
      params: { period: '30d' },
    });

    expect(card('Active operators')).toEqual({ value: '3', sub: 'of 5 operators' });
    expect(card('Going quiet').value).toBe('1');
    expect(card('Near card limit').value).toBe('1');
    expect(card('Not started').value).toBe('1');

    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Operator',
      'Plan',
      'Days left',
      'Routers online',
      'Cards created',
      'Cards used',
      'Sales value',
      'Change',
      'Last active',
    ]);

    // As delivered by the server.
    expect(operatorOrder()).toEqual([
      'Cafe Nile',
      'Atbara Net',
      'Kassala Wifi',
      'New Shop',
      'Sennar Cafe',
    ]);

    const nile = cellsOf('Cafe Nile');
    expect(nile[0]).toContain('nile@example.com');
    expect(nile.slice(1)).toEqual([
      'Pro',
      '5',
      '2 of 2',
      '1,200',
      '950',
      'SDG 475,000',
      '+18%',
      '15/11/2026, 11:40', // 09:40 UTC on the Khartoum clock
    ]);
    expect(cellsOf('Atbara Net').slice(1, 8)).toEqual([
      'Starter',
      '13',
      '1 of 3',
      '300',
      '40',
      'SDG 20,000',
      '-62%',
    ]);
    // A tier with no plans row arrives named after the tier.
    expect(cellsOf('Sennar Cafe')[1]).toBe('legacy');

    // The name opens the operator's page.
    expect(screen.getByRole('link', { name: 'Cafe Nile' })).toHaveAttribute('href', '/users/u-nile');

    // Each flag is named on its row, so a filter is never the only way to see it.
    expect(within(rowOf('Atbara Net')).getByText('Quiet')).toBeInTheDocument();
    expect(within(rowOf('Kassala Wifi')).getByText('Near limit')).toBeInTheDocument();
    expect(within(rowOf('New Shop')).getByText('Not started')).toBeInTheDocument();
    expect(within(rowOf('Cafe Nile')).queryByText('Quiet')).not.toBeInTheDocument();

    expect(screen.getByText('Figures as of 15 Nov 2026, 12:20')).toBeInTheDocument();
  });

  it('sorting by Cards used reorders rows and nulls stay last', async () => {
    const user = userEvent.setup();
    renderTab();
    await loaded();

    await user.click(screen.getByRole('button', { name: 'Cards used' }));
    expect(screen.getByRole('columnheader', { name: /Cards used/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    // Equal values keep the order they came in.
    expect(operatorOrder()).toEqual([
      'New Shop',
      'Sennar Cafe',
      'Atbara Net',
      'Cafe Nile',
      'Kassala Wifi',
    ]);

    await user.click(screen.getByRole('button', { name: 'Cards used' }));
    expect(screen.getByRole('columnheader', { name: /Cards used/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(operatorOrder()).toEqual([
      'Kassala Wifi',
      'Cafe Nile',
      'Atbara Net',
      'New Shop',
      'Sennar Cafe',
    ]);

    // Change is empty for three operators: they stay at the bottom both ways.
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(operatorOrder()).toEqual([
      'Atbara Net',
      'Cafe Nile',
      'Kassala Wifi',
      'New Shop',
      'Sennar Cafe',
    ]);
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(operatorOrder()).toEqual([
      'Cafe Nile',
      'Atbara Net',
      'Kassala Wifi',
      'New Shop',
      'Sennar Cafe',
    ]);

    // Last active is empty for one operator.
    await user.click(screen.getByRole('button', { name: 'Last active' }));
    expect(operatorOrder()).toEqual([
      'Sennar Cafe',
      'Atbara Net',
      'Kassala Wifi',
      'Cafe Nile',
      'New Shop',
    ]);
    await user.click(screen.getByRole('button', { name: 'Last active' }));
    expect(operatorOrder()).toEqual([
      'Cafe Nile',
      'Kassala Wifi',
      'Atbara Net',
      'Sennar Cafe',
      'New Shop',
    ]);
  });

  it('the Quiet chip shows only rows flagged isQuiet', async () => {
    const user = userEvent.setup();
    renderTab();
    await loaded();

    expect(chip('All')).toHaveAttribute('aria-pressed', 'true');
    // Each chip says how many rows it keeps.
    expect(chipNames()).toEqual(['All 5', 'Quiet 1', 'Near limit 1', 'Not started 1']);

    await user.click(chip('Quiet'));
    expect(chip('Quiet')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('All')).toHaveAttribute('aria-pressed', 'false');
    expect(operatorOrder()).toEqual(['Atbara Net']);
    // The counts do not depend on the chip that is pressed.
    expect(chipNames()).toEqual(['All 5', 'Quiet 1', 'Near limit 1', 'Not started 1']);

    await user.click(chip('Near limit'));
    expect(operatorOrder()).toEqual(['Kassala Wifi']);

    await user.click(chip('Not started'));
    expect(operatorOrder()).toEqual(['New Shop']);

    await user.click(chip('All'));
    expect(operatorOrder()).toHaveLength(5);
  });

  it('search matches the operator name and email', async () => {
    const user = userEvent.setup();
    renderTab();
    await loaded();

    // By name, ignoring case.
    await user.type(searchBox(), 'cafe');
    expect(operatorOrder()).toEqual(['Cafe Nile', 'Sennar Cafe']);

    // By email: "newshop@" is not in any name.
    await user.clear(searchBox());
    await user.type(searchBox(), 'NEWSHOP@');
    expect(operatorOrder()).toEqual(['New Shop']);

    // Search and a chip narrow together.
    await user.clear(searchBox());
    await user.type(searchBox(), 'n');
    expect(operatorOrder()).toEqual(['Cafe Nile', 'Atbara Net', 'New Shop', 'Sennar Cafe']);
    // The chips count within the search.
    expect(chipNames()).toEqual(['All 4', 'Quiet 1', 'Near limit 0', 'Not started 1']);
    await user.click(chip('Quiet'));
    expect(operatorOrder()).toEqual(['Atbara Net']);

    await user.click(chip('Near limit'));
    expect(operatorOrder()).toEqual([]);
    expect(screen.getByText('No operators match this search or filter.')).toBeInTheDocument();
  });

  it('the export button carries period, q, filter, sort and dir', async () => {
    const user = userEvent.setup();
    renderTab({ period: '3m' });
    await loaded();

    await user.type(searchBox(), ' atbara ');
    await user.click(chip('Quiet'));
    await user.click(screen.getByRole('button', { name: 'Cards used' }));
    await user.click(screen.getByRole('button', { name: 'Cards used' }));
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(EXPORT_PATH, {
        params: { period: '3m', q: 'atbara', filter: 'quiet', sort: 'cardsUsed', dir: 'desc' },
        responseType: 'blob',
      }),
    );
  });

  it('the export of an untouched table carries only the period', async () => {
    const user = userEvent.setup();
    renderTab({ from: '2026-11-01', to: '2026-11-10' });
    await loaded();

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(EXPORT_PATH, {
        params: { from: '2026-11-01', to: '2026-11-10' },
        responseType: 'blob',
      }),
    );
  });

  it('shows "—" for Change and Last active when they are null', async () => {
    renderTab();
    await loaded();

    // No subscription, no use, never logged in since launch.
    expect(cellsOf('New Shop').slice(1)).toEqual([
      '—',
      '—',
      '0 of 0',
      '0',
      '0',
      'SDG 0',
      '—',
      '—',
    ]);

    // Used cards, but nothing to compare with: only Change is empty.
    const kassala = cellsOf('Kassala Wifi');
    expect(kassala[7]).toBe('—');
    expect(kassala[8]).toBe('14/11/2026, 22:30');
  });

  it('renders the empty state when there are no operators', async () => {
    mockGet.mockImplementation(
      apiGet({ operators: emptyOperatorsFixture(), meta: emptyMetaFixture() }),
    );
    const { container } = renderTab();

    expect(await screen.findByText('No operators yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    expect(card('Active operators')).toEqual({ value: '0', sub: 'of 0 operators' });
    expect(card('Going quiet').value).toBe('0');
    expect(card('Near card limit').value).toBe('0');
    expect(card('Not started').value).toBe('0');

    // The summaries never ran: say so, in amber.
    expect(screen.getByText('No figures yet').closest('[data-stale]')).toHaveAttribute(
      'data-stale',
      'true',
    );
    expect(container.textContent).not.toMatch(/NaN|Infinity|undefined|null/);
  });

  it('shows ErrorPanel and refetches on retry', async () => {
    const user = userEvent.setup();
    mockGet.mockImplementationOnce(() =>
      Promise.reject({ response: { data: { error: { message: 'Summaries are locked' } } } }),
    );
    renderTab();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to load data');
    expect(alert).toHaveTextContent('Summaries are locked');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));

    await loaded();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('pages the table 20 operators at a time and returns to page 1 when the view changes', async () => {
    const user = userEvent.setup();
    const base = operatorsFixture().rows[0];
    const rows: OperatorRow[] = Array.from({ length: 45 }, (_, i) => ({
      ...base,
      userId: `u-${i + 1}`,
      operator: `Operator ${String(i + 1).padStart(2, '0')}`,
      email: `op${i + 1}@example.com`,
      cardsUsed: i,
    }));
    mockGet.mockImplementation(apiGet({ operators: operatorsFixture({ rows }) }));
    renderTab();
    await screen.findByRole('link', { name: 'Operator 01' });

    expect(operatorOrder()).toHaveLength(20);
    expect(screen.getByText('Showing 1 to 20 of 45 results')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Showing 21 to 40 of 45 results')).toBeInTheDocument();
    expect(operatorOrder()[0]).toBe('Operator 21');

    // Sorting covers every row, not only the page on screen.
    await user.click(screen.getByRole('button', { name: 'Cards used' }));
    await user.click(screen.getByRole('button', { name: 'Cards used' }));
    expect(screen.getByText('Showing 1 to 20 of 45 results')).toBeInTheDocument();
    expect(operatorOrder()[0]).toBe('Operator 45');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(operatorOrder()[0]).toBe('Operator 25');

    // "Operator 4" keeps 40–45: one short page, from its start.
    await user.type(searchBox(), 'Operator 4');
    expect(screen.getByText('Showing 1 to 6 of 6 results')).toBeInTheDocument();
    expect(operatorOrder()).toHaveLength(6);
  });

  it('reads q, filter, sort and dir from the URL and writes changes back', async () => {
    const user = userEvent.setup();
    renderTab({ period: '3m' }, '?period=3m&q=n&filter=quiet&sort=cardsUsed&dir=desc');
    await screen.findByRole('link', { name: 'Atbara Net' });

    expect(searchBox()).toHaveValue('n');
    expect(chip('Quiet')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('columnheader', { name: /Cards used/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(operatorOrder()).toEqual(['Atbara Net']);

    // Dropping the filter leaves the period and the rest of the table state alone.
    await user.click(chip('All'));
    expect(operatorOrder()).toEqual(['Cafe Nile', 'Atbara Net', 'New Shop', 'Sennar Cafe']);
    await waitFor(() =>
      expect(urlParams()).toEqual({ period: '3m', q: 'n', sort: 'cardsUsed', dir: 'desc' }),
    );

    await user.click(chip('Not started'));
    await user.click(screen.getByRole('button', { name: 'Operator' }));
    await waitFor(() =>
      expect(urlParams()).toEqual({
        period: '3m',
        q: 'n',
        filter: 'not-started',
        sort: 'operator',
        dir: 'asc',
      }),
    );

    await user.clear(searchBox());
    await waitFor(() =>
      expect(urlParams()).toEqual({
        period: '3m',
        filter: 'not-started',
        sort: 'operator',
        dir: 'asc',
      }),
    );
  });

  it('takes over a URL change it did not make, and leaves that URL alone', async () => {
    const user = userEvent.setup();
    renderTab({ period: '30d' }, '?period=30d', true);
    await loaded();

    await user.type(searchBox(), 'n');
    await user.click(chip('Quiet'));
    await waitFor(() => expect(urlParams()).toEqual({ period: '30d', q: 'n', filter: 'quiet' }));

    // The tab's own link drops the table state: the table starts over.
    await user.click(screen.getByRole('link', { name: 'Operators tab' }));
    await waitFor(() => expect(searchBox()).toHaveValue(''));
    expect(chip('All')).toHaveAttribute('aria-pressed', 'true');
    expect(operatorOrder()).toHaveLength(5);
    // Longer than the table waits before writing: it must not put its old state back.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(urlParams()).toEqual({ period: '30d' });

    // A link that carries a table state is shown as it says.
    await user.click(screen.getByRole('link', { name: 'Near limit view' }));
    await waitFor(() => expect(chip('Near limit')).toHaveAttribute('aria-pressed', 'true'));
    expect(operatorOrder()).toEqual(['Kassala Wifi']);
    expect(screen.getByRole('columnheader', { name: /Cards used/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('keeps a choice that is not in the URL yet when the period changes', async () => {
    const user = userEvent.setup();
    renderTab({ period: '30d' }, '?period=30d', true);
    await loaded();

    // The period picker rewrites the URL before the table has written "n" to it.
    await user.type(searchBox(), 'n');
    await user.click(screen.getByRole('button', { name: 'Period 12m' }));

    await waitFor(() => expect(urlParams()).toEqual({ period: '12m', q: 'n' }));
    expect(searchBox()).toHaveValue('n');
    expect(operatorOrder()).toEqual(['Cafe Nile', 'Atbara Net', 'New Shop', 'Sennar Cafe']);
  });

  it('ignores a filter or sort the table does not have', async () => {
    renderTab({ period: '30d' }, '?filter=dropping&sort=secret&dir=desc');
    await loaded();

    expect(chip('All')).toHaveAttribute('aria-pressed', 'true');
    expect(operatorOrder()).toHaveLength(5);
    for (const header of screen.getAllByRole('columnheader')) {
      expect(header).not.toHaveAttribute('aria-sort');
    }
  });

  it('keeps the previous figures on screen, dimmed, while a new period loads', async () => {
    const client = newClient();
    let release: (value: unknown) => void = () => {};
    const view = render(tree(client, { period: '30d' }, ''));
    await loaded();

    const next = operatorsFixture();
    next.rows = next.rows.slice(0, 1);
    next.cards = { active: 1, total: 1, quiet: 0, nearLimit: 0, notStarted: 0 };
    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    view.rerender(tree(client, { period: '12m' }, ''));

    await waitFor(() =>
      expect(mockGet).toHaveBeenLastCalledWith('/admin/analytics/operators', {
        params: { period: '12m' },
      }),
    );
    // No skeleton flash: the old rows stay, marked busy.
    expect(operatorOrder()).toHaveLength(5);
    expect(screen.getByRole('table').closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');

    release(analyticsResponse(next, metaFixture({ period: '12m' })));
    await waitFor(() => expect(operatorOrder()).toEqual(['Cafe Nile']));
    expect(screen.getByRole('table').closest('[aria-busy]')).toHaveAttribute('aria-busy', 'false');
    expect(card('Active operators')).toEqual({ value: '1', sub: 'of 1 operator' });
  });

  it('explains an empty Change column while the previous period predates the use history', async () => {
    // Previous period 17 Jun – 31 Aug, use history from 20 Oct: nothing to compare with.
    const view = renderTab();
    await loaded();
    expect(screen.getByText(/Use history begins on 20 Oct 2026/)).toBeInTheDocument();
    view.unmount();

    mockGet.mockImplementation(
      apiGet({
        meta: metaFixture({
          range: { from: '2026-12-20', to: '2027-01-18' },
          previous: { from: '2026-11-20', to: '2026-12-19' },
        }),
      }),
    );
    renderTab();
    await loaded();
    expect(screen.queryByText(/Use history begins on/)).not.toBeInTheDocument();
  });
});
