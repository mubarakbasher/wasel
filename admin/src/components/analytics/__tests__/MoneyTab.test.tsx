import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Mock the axios wrapper: answer the money endpoint and capture the calls.
vi.mock('../../../lib/api', () => ({
  default: { get: vi.fn() },
}));

import api from '../../../lib/api';
import { ToastProvider } from '../../../hooks/useToast';
import type { PeriodQuery } from '../../../lib/period';
import {
  analyticsGet,
  analyticsResponse,
  emptyMoneyFixture,
  metaFixture,
  moneyFixture,
} from '../../../tests/analyticsFixtures';
import MoneyTab from '../MoneyTab';

const mockGet = api.get as unknown as Mock;

function tree(period: PeriodQuery, queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <MoneyTab period={period} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderTab(period: PeriodQuery = { period: '3m' }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const view = render(tree(period, queryClient));
  return { ...view, setPeriod: (next: PeriodQuery) => view.rerender(tree(next, queryClient)) };
}

/** The text column of a stat card: its title, value and the line under them. */
function card(title: string): HTMLElement {
  return screen.getByText(title).parentElement as HTMLElement;
}

/** A titled block of the tab: a chart card or a table with its heading. */
function section(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

function rowOf(scope: HTMLElement, operator: string): HTMLElement {
  return within(scope).getByText(operator).closest('tr') as HTMLElement;
}

/** The hidden data table of a chart, as rows of cell texts. */
function chartTable(name: string): string[][] {
  const table = screen.getByRole('table', { name: `${name} (data table)` });
  return Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
    Array.from(tr.children).map((cell) => cell.textContent ?? ''),
  );
}

/** Every attribute and every piece of text the tab put in the DOM. */
function domDump(container: HTMLElement): string {
  const attrs = Array.from(container.querySelectorAll('*')).flatMap((el) =>
    Array.from(el.attributes).map((a) => `${a.name}=${a.value}`),
  );
  return [...attrs, container.textContent ?? ''].join('\n');
}

describe('MoneyTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation(analyticsGet());
  });

  it('shows the four cards with formatted amounts and "+3 granted"', async () => {
    // A fixed answer time (15 Nov, 10:20 UTC), so the age of the oldest waiting
    // payment (13 Nov, 08:30 UTC) does not depend on the clock of the test run.
    mockGet.mockImplementation(analyticsGet({ meta: metaFixture() }));
    renderTab();
    expect(await screen.findByText('Income this month')).toBeInTheDocument();

    const income = card('Income this month');
    expect(within(income).getByText('SDG 1,240,000')).toBeInTheDocument();
    expect(within(income).getByText('+18%').closest('[data-delta]')).toHaveAttribute(
      'data-delta',
      'up',
    );
    expect(income).toHaveTextContent('vs same days last month');

    const paying = card('Paying operators');
    expect(within(paying).getByText('41')).toBeInTheDocument();
    expect(within(paying).getByText('+3 granted')).toBeInTheDocument();

    const due = card('Due to renew in 30 days');
    expect(within(due).getByText('SDG 135,000')).toBeInTheDocument();
    expect(due).toHaveTextContent('3 operators');
    // One of the three amounts is the operator's last payment, not a list price.
    expect(due).toHaveTextContent('partly estimated');

    const waiting = card('Payments waiting');
    expect(within(waiting).getByText('2')).toBeInTheDocument();
    expect(waiting).toHaveTextContent('SDG 170,000');
    expect(waiting).toHaveTextContent('oldest 2d ago');
    expect(within(waiting).getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/payments',
    );
  });

  it('shows "—" for the change when changePct is null', async () => {
    const money = moneyFixture();
    money.cards.changePct = null;
    money.cards.incomeSameDaysLastMonth = 0;
    mockGet.mockImplementation(analyticsGet({ money }));
    renderTab();
    await screen.findByText('Income this month');

    const income = card('Income this month');
    expect(within(income).getByText('—')).toBeInTheDocument();
    expect(income).toHaveTextContent('— vs same days last month');
    // No arrow and no percentage: there is nothing to compare with.
    expect(income.querySelector('[data-delta]')).toBeNull();
    expect(income).not.toHaveTextContent('%');
  });

  it('marks a fall in income as bad news and no change as flat', async () => {
    const money = moneyFixture();
    money.cards.changePct = -62;
    mockGet.mockImplementation(analyticsGet({ money }));
    const first = renderTab();
    await screen.findByText('Income this month');
    const down = within(card('Income this month')).getByText('-62%').closest('[data-delta]');
    expect(down).toHaveAttribute('data-delta', 'down');
    expect(down).toHaveClass('text-red-700');
    first.unmount();

    money.cards.changePct = 0.2;
    mockGet.mockImplementation(analyticsGet({ money }));
    renderTab();
    await screen.findByText('Income this month');
    expect(
      within(card('Income this month')).getByText('0%').closest('[data-delta]'),
    ).toHaveAttribute('data-delta', 'flat');
  });

  it('renders the renewals-due and lost tables with a "granted" tag and a "(deleted)" mark', async () => {
    renderTab();
    const due = await screen.findByRole('region', { name: 'Renewals due in the next 30 days' });

    expect(
      within(due)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Operator', 'Plan', 'Ends', 'Amount', 'Paid before']);
    // As delivered: the soonest end first.
    expect(
      within(due)
        .getAllByRole('row')
        .slice(1)
        .map((tr) => tr.querySelector('a')?.textContent),
    ).toEqual(['Cafe Nile', 'Atbara Net', 'Kassala Wifi']);

    const nile = rowOf(due, 'Cafe Nile');
    expect(nile).toHaveTextContent('nile@example.com');
    expect(nile).toHaveTextContent('Pro');
    expect(nile).toHaveTextContent('20/11/2026');
    expect(within(nile).getAllByRole('cell')[3]).toHaveTextContent(/^SDG 90,000$/);
    // Paid before is how many times, not how much.
    expect(within(nile).getAllByRole('cell')[4]).toHaveTextContent(/^6 times$/);
    expect(within(nile).queryByText('granted')).toBeNull();
    expect(within(nile).queryByText('est.')).toBeNull();
    expect(within(nile).getByRole('link', { name: 'Cafe Nile' })).toHaveAttribute(
      'href',
      '/users/u-nile',
    );

    // A tier with no plan row: the amount is the operator's last payment.
    const atbara = rowOf(due, 'Atbara Net');
    expect(atbara).toHaveTextContent('SDG 45,000');
    expect(within(atbara).getByText('est.')).toBeInTheDocument();
    expect(within(atbara).getAllByRole('cell')[4]).toHaveTextContent(/^Once$/);

    // Granted without a payment: tagged, no amount, and never paid.
    const kassala = rowOf(due, 'Kassala Wifi');
    expect(within(kassala).getByText('granted')).toBeInTheDocument();
    expect(within(kassala).getAllByRole('cell')[3]).toHaveTextContent(/^—$/);
    expect(within(kassala).getAllByRole('cell')[4]).toHaveTextContent(/^Never$/);

    const lost = section('Operators lost');
    expect(
      within(lost)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Operator', 'Plan', 'Ended', 'Months paid', 'Total paid']);

    const dongola = rowOf(lost, 'Dongola Link');
    expect(dongola).toHaveTextContent('28/10/2026');
    expect(dongola).toHaveTextContent('SDG 225,000');
    expect(within(dongola).getAllByRole('cell')[3]).toHaveTextContent(/^5$/);
    expect(within(dongola).queryByText('(deleted)')).toBeNull();
    expect(within(dongola).getByRole('link', { name: 'Dongola Link' })).toHaveAttribute(
      'href',
      '/users/u-dongola',
    );

    // A deleted operator stays in the list, marked, with no page to open.
    const gone = rowOf(lost, 'Port Sudan Hotspot');
    expect(within(gone).getByText('(deleted)')).toBeInTheDocument();
    expect(gone).toHaveTextContent('SDG 120,000');
    expect(within(gone).queryByRole('link')).toBeNull();
  });

  it('prints "Paid before" as a count of payments: Never, Once, then "N times"', async () => {
    const base = moneyFixture().renewalsDue[0];
    const counts = [0, 1, 2, 3, 1_200];
    const renewalsDue = counts.map((paidBefore, i) => ({
      ...base,
      userId: `u-${i}`,
      operator: `Operator ${i}`,
      paidBefore,
    }));
    mockGet.mockImplementation(analyticsGet({ money: moneyFixture({ renewalsDue }) }));
    renderTab();
    const due = await screen.findByRole('region', { name: 'Renewals due in the next 30 days' });

    const paidBefore = within(due)
      .getAllByRole('row')
      .slice(1)
      .map((tr) => within(tr).getAllByRole('cell')[4]);
    expect(paidBefore.map((cell) => cell.textContent)).toEqual([
      'Never',
      'Once',
      '2 times',
      '3 times',
      '1,200 times',
    ]);
    // A count is never dressed as money.
    for (const cell of paidBefore) expect(cell).not.toHaveTextContent('SDG');
  });

  it('pages a long table 20 rows at a time', async () => {
    const user = userEvent.setup();
    const base = moneyFixture().lost[0];
    const lost = Array.from({ length: 23 }, (_, i) => ({
      ...base,
      userId: `u-${i + 1}`,
      operator: `Operator ${i + 1}`,
    }));
    mockGet.mockImplementation(analyticsGet({ money: moneyFixture({ lost }) }));
    renderTab();
    const region = await screen.findByRole('region', { name: 'Operators lost' });

    expect(within(region).getAllByRole('row')).toHaveLength(21);
    expect(region).toHaveTextContent('Showing 1 to 20 of 23 results');

    await user.click(within(region).getByRole('button', { name: /Next/ }));
    expect(within(region).getAllByRole('row')).toHaveLength(4);
    expect(within(region).getByText('Operator 23')).toBeInTheDocument();
  });

  it('shows the paid-not-activated notice only when the list is non-empty', async () => {
    const first = renderTab();
    const notice = await screen.findByRole('region', { name: 'Paid but not switched on' });
    expect(within(notice).getByRole('link', { name: 'Sennar Cafe' })).toHaveAttribute(
      'href',
      '/users/u-sennar',
    );
    expect(notice).toHaveTextContent('Pro');
    expect(notice).toHaveTextContent('SDG 90,000');
    // Approved at 09:15 UTC, shown on the Khartoum clock.
    expect(notice).toHaveTextContent('08/11/2026, 11:15');
    first.unmount();

    mockGet.mockImplementation(analyticsGet({ money: moneyFixture({ paidNotActivated: [] }) }));
    renderTab();
    await screen.findByText('Income this month');
    expect(screen.queryByRole('region', { name: 'Paid but not switched on' })).toBeNull();
    expect(screen.queryByText('Sennar Cafe')).toBeNull();
  });

  it('shows the deleted-operators line only when the amount is above zero', async () => {
    const first = renderTab();
    const income = await screen.findByRole('region', { name: 'Income per month' });
    expect(income).toHaveTextContent('SDG 3,890,000');
    expect(
      within(income).getByText('Includes SDG 120,000 from deleted operators'),
    ).toBeInTheDocument();
    first.unmount();

    mockGet.mockImplementation(
      analyticsGet({
        money: moneyFixture({ income: { total: 3_890_000, fromDeletedOperators: 0 } }),
      }),
    );
    renderTab();
    expect(await screen.findByRole('region', { name: 'Income per month' })).toHaveTextContent(
      'SDG 3,890,000',
    );
    expect(screen.queryByText(/from deleted operators/)).toBeNull();
  });

  it('draws income per month stacked, income by plan, and the renewal rate with provisional months lighter', async () => {
    renderTab();
    await screen.findByRole('region', { name: 'Income per month' });

    // en-GB prints September as "Sept".
    expect(chartTable('Income per month')).toEqual([
      ['Sept 2026', 'SDG 300,000', 'SDG 900,000', 'SDG 50,000', 'SDG 1,250,000'],
      ['Oct 2026', 'SDG 250,000', 'SDG 1,050,000', 'SDG 100,000', 'SDG 1,400,000'],
      ['Nov 2026', 'SDG 340,000', 'SDG 820,000', 'SDG 80,000', 'SDG 1,240,000'],
    ]);
    const income = section('Income per month');
    expect(income.querySelectorAll('[data-mark="bar"]')).toHaveLength(9);
    const legend = income.querySelector('[data-chart-legend]')!;
    expect(legend).toHaveTextContent('New');
    expect(legend).toHaveTextContent('Renewal');
    expect(legend).toHaveTextContent('Plan change');

    expect(chartTable('Income by plan')).toEqual([
      ['Pro', 'SDG 2,334,000', '60%'],
      ['Starter', 'SDG 1,167,000', '30%'],
      ['Enterprise', 'SDG 389,000', '10%'],
    ]);

    expect(chartTable('Renewal rate per month')).toEqual([
      ['Sept 2026', '85%'],
      ['Oct 2026', '75%'],
      ['Nov 2026', '50%'],
    ]);
    const rate = section('Renewal rate per month');
    const bars = Array.from(rate.querySelectorAll('[data-mark="bar"]'));
    expect(bars).toHaveLength(3);
    expect(bars[0]).not.toHaveClass('opacity-40');
    expect(bars[1]).toHaveClass('opacity-40');
    expect(bars[2]).toHaveClass('opacity-40');
    // The axis is a percentage scale that ends at 100.
    expect(
      Array.from(rate.querySelectorAll('[data-chart-axis="y"] span')).map((el) => el.textContent),
    ).toEqual(['0%', '25%', '50%', '75%', '100%']);
    // A lighter bar is explained in words, not left to the colour.
    expect(rate).toHaveTextContent(/Lighter bars/);
  });

  it('prints "—" for a month in which nothing ended, and keeps a real 0%', async () => {
    mockGet.mockImplementation(
      analyticsGet({
        money: moneyFixture({
          renewalRate: [
            { month: '2026-09', ended: 4, renewed: 0, ratePct: 0, provisional: false },
            { month: '2026-10', ended: 0, renewed: 0, ratePct: null, provisional: true },
            { month: '2026-11', ended: 6, renewed: 3, ratePct: 50, provisional: true },
          ],
        }),
      }),
    );
    renderTab();
    await screen.findByRole('region', { name: 'Renewal rate per month' });

    expect(chartTable('Renewal rate per month')).toEqual([
      ['Sept 2026', '0%'],
      ['Oct 2026', '—'],
      ['Nov 2026', '50%'],
    ]);

    const rate = section('Renewal rate per month');
    // Nothing rises in September (a bar of no height) or in October (no bar at
    // all): the two are told apart by what the column reads.
    const bars = rate.querySelectorAll('[data-mark="bar"]');
    expect(Array.from(bars).map((bar) => bar.getAttribute('data-index'))).toEqual(['2']);
    expect(
      Array.from(rate.querySelectorAll('[data-chart-hit]')).map((hit) =>
        hit.getAttribute('aria-label'),
      ),
    ).toEqual([
      'Sept 2026: Renewal rate 0%',
      'Oct 2026: Renewal rate —',
      'Nov 2026: Renewal rate 50%',
    ]);
    // Every month of the range keeps its column and its label, drawn or empty.
    expect(
      Array.from(rate.querySelectorAll('[data-chart-axis="x"] span')).map((el) => el.textContent),
    ).toEqual(['Sept 2026', 'Oct 2026', 'Nov 2026']);
    // October is provisional, but has no bar to draw lighter: only November's is.
    expect(bars[0]).toHaveClass('opacity-40');
    expect(rate).toHaveTextContent(/Lighter bars/);
  });

  it('keeps the renewal chart, with its months, when no month has a rate above zero', async () => {
    mockGet.mockImplementation(
      analyticsGet({
        money: moneyFixture({
          renewalRate: [
            { month: '2026-09', ended: 0, renewed: 0, ratePct: null, provisional: false },
            { month: '2026-10', ended: 3, renewed: 0, ratePct: 0, provisional: true },
          ],
        }),
      }),
    );
    const first = renderTab();
    await screen.findByRole('region', { name: 'Renewal rate per month' });

    // A real 0% is a figure: the chart is drawn, with no bar and no "lighter" caption.
    expect(chartTable('Renewal rate per month')).toEqual([
      ['Sept 2026', '—'],
      ['Oct 2026', '0%'],
    ]);
    const rate = section('Renewal rate per month');
    expect(rate.querySelector('[data-chart-empty]')).toBeNull();
    expect(rate.querySelector('[data-mark="bar"]')).toBeNull();
    expect(rate).not.toHaveTextContent(/Lighter bars/);
    first.unmount();

    // Nothing ended in any month: there is no rate at all, so the empty block.
    mockGet.mockImplementation(
      analyticsGet({
        money: moneyFixture({
          renewalRate: [
            { month: '2026-09', ended: 0, renewed: 0, ratePct: null, provisional: false },
            { month: '2026-10', ended: 0, renewed: 0, ratePct: null, provisional: true },
          ],
        }),
      }),
    );
    renderTab();
    const empty = await screen.findByRole('region', { name: 'Renewal rate per month' });
    expect(empty.querySelector('[data-chart-empty]')).toHaveTextContent(
      'No paid plans ended in this period',
    );
  });

  it('adds the tier to plan names that two slices share', async () => {
    mockGet.mockImplementation(
      analyticsGet({
        money: moneyFixture({
          incomeByPlan: [
            { planTier: 'pro', planName: 'Pro', amount: 600_000, sharePct: 60 },
            { planTier: 'pro_2025', planName: 'Pro', amount: 300_000, sharePct: 30 },
            { planTier: 'starter', planName: 'Starter', amount: 100_000, sharePct: 10 },
          ],
        }),
      }),
    );
    renderTab();
    await screen.findByRole('region', { name: 'Income by plan' });

    expect(chartTable('Income by plan').map((row) => row[0])).toEqual([
      'Pro (pro)',
      'Pro (pro_2025)',
      'Starter',
    ]);
  });

  it('renders empty states with no NaN when every array is empty and every number is 0', async () => {
    mockGet.mockImplementation(analyticsGet({ money: emptyMoneyFixture() }));
    const { container } = renderTab();
    await screen.findByText('Income this month');

    const income = card('Income this month');
    expect(within(income).getByText('SDG 0')).toBeInTheDocument();
    expect(income).toHaveTextContent('— vs same days last month');
    const paying = card('Paying operators');
    expect(within(paying).getByText('0')).toBeInTheDocument();
    expect(within(paying).getByText('+0 granted')).toBeInTheDocument();
    const due = card('Due to renew in 30 days');
    expect(within(due).getByText('SDG 0')).toBeInTheDocument();
    expect(due).toHaveTextContent('0 operators');
    expect(due).not.toHaveTextContent('estimated');
    const waiting = card('Payments waiting');
    expect(within(waiting).getByText('0')).toBeInTheDocument();
    expect(waiting).toHaveTextContent('Nothing to review');
    expect(within(waiting).queryByRole('link')).toBeNull();

    // Each chart keeps its place with a same-height empty block.
    const empties = Array.from(container.querySelectorAll<HTMLElement>('[data-chart-empty]'));
    expect(empties.map((el) => el.getAttribute('aria-label'))).toEqual([
      'Income per month',
      'Income by plan',
      'Renewal rate per month',
    ]);
    for (const el of empties) expect(el.style.height).toBe('240px');
    expect(section('Income per month')).toHaveTextContent('No income in this period');
    expect(section('Income per month')).toHaveTextContent('SDG 0');

    expect(section('Renewals due in the next 30 days')).toHaveTextContent(
      'No renewals due in the next 30 days.',
    );
    expect(section('Operators lost')).toHaveTextContent('No operators lost in this period.');
    expect(screen.queryByRole('region', { name: 'Paid but not switched on' })).toBeNull();
    expect(screen.queryByText(/from deleted operators/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    expect(domDump(container)).not.toMatch(/NaN|Infinity|undefined|\bnull\b/);
  });

  it('shows ErrorPanel and refetches on retry', async () => {
    const user = userEvent.setup();
    mockGet.mockRejectedValueOnce({
      response: { data: { success: false, error: { message: 'Database is busy', code: 'X' } } },
    });
    renderTab();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to load data');
    expect(alert).toHaveTextContent('Database is busy');
    expect(screen.queryByText('Income this month')).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(1);

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Income this month')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenLastCalledWith('/admin/analytics/money', {
      params: { period: '3m' },
    });
  });

  it('export buttons carry the current period', async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const answer = analyticsGet();
    mockGet.mockImplementation(async (url: string) =>
      url.endsWith('/export') ? { data: new Blob(['operator']), headers: {} } : answer(url),
    );

    const view = renderTab({ period: '12m' });
    const due = await screen.findByRole('region', { name: 'Renewals due in the next 30 days' });

    await user.click(within(due).getByRole('button', { name: 'Export CSV' }));
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/money/renewals-due/export', {
        params: { period: '12m' },
        responseType: 'blob',
      }),
    );

    await user.click(within(section('Operators lost')).getByRole('button', { name: 'Export CSV' }));
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/money/lost/export', {
        params: { period: '12m' },
        responseType: 'blob',
      }),
    );
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(2));

    // A custom range travels as its two days.
    view.setPeriod({ from: '2026-10-01', to: '2026-10-31' });
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/money', {
        params: { from: '2026-10-01', to: '2026-10-31' },
      }),
    );
    await user.click(within(section('Operators lost')).getByRole('button', { name: 'Export CSV' }));
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/money/lost/export', {
        params: { from: '2026-10-01', to: '2026-10-31' },
        responseType: 'blob',
      }),
    );

    clickSpy.mockRestore();
  });

  it('keeps the previous figures, dimmed, while another period loads', async () => {
    const view = renderTab({ period: 'month' });
    await screen.findByText('Income this month');
    const figures = screen.getByTestId('money-figures');
    expect(figures).toHaveAttribute('aria-busy', 'false');
    expect(figures).not.toHaveClass('opacity-60');

    // The next period answers only when the test lets it.
    let answerNext: (value: unknown) => void = () => {};
    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerNext = resolve;
        }),
    );
    view.setPeriod({ period: '12m' });

    await waitFor(() => expect(screen.getByTestId('money-figures')).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByTestId('money-figures')).toHaveClass('opacity-60');
    // No skeleton flash: the old numbers stay on screen.
    expect(within(card('Income this month')).getByText('SDG 1,240,000')).toBeInTheDocument();

    const next = moneyFixture();
    next.cards.incomeThisMonth = 2_000_000;
    answerNext(analyticsResponse(next));

    expect(await screen.findByText('SDG 2,000,000')).toBeInTheDocument();
    expect(screen.getByTestId('money-figures')).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByTestId('money-figures')).not.toHaveClass('opacity-60');
  });

  it('is stamped live, names the period of the total, and explains how income is dated', async () => {
    renderTab();
    await screen.findByText('Income this month');

    expect(screen.getByText(/^Live/)).toBeInTheDocument();
    // meta.range of the fixture: 1 September to 15 November 2026.
    expect(section('Income per month')).toHaveTextContent('1 Sept – 15 Nov 2026');
    expect(
      screen.getByText('Income is counted on the day a payment was approved, Khartoum time.'),
    ).toBeInTheDocument();
  });
});
