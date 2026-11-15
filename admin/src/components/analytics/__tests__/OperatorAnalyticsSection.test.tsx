import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the axios wrapper: answer the operator endpoint and capture the calls.
vi.mock('../../../lib/api', () => ({
  default: { get: vi.fn() },
}));

import api from '../../../lib/api';
import {
  analyticsGet,
  analyticsResponse,
  emptyMetaFixture,
  emptyOperatorFixture,
  metaFixture,
  operatorFixture,
} from '../../../tests/analyticsFixtures';
import OperatorAnalyticsSection from '../OperatorAnalyticsSection';

const mockGet = api.get as unknown as Mock;

const PATH = '/admin/analytics/operators/u-nile';
const CARDS_CHART = 'Cards created and used per day';
const SALES_CHART = 'Sales value per day';

/** A meta whose range is exactly the three days the operator fixture has. */
function threeDayMeta() {
  return metaFixture({
    period: 'custom',
    range: { from: '2026-11-13', to: '2026-11-15' },
    previous: { from: '2026-11-10', to: '2026-11-12' },
  });
}

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function tree(client: QueryClient, userId: string) {
  return (
    <QueryClientProvider client={client}>
      <OperatorAnalyticsSection userId={userId} />
    </QueryClientProvider>
  );
}

function renderSection(userId = 'u-nile') {
  return render(tree(newClient(), userId));
}

function periodGroup(): HTMLElement {
  return screen.getByRole('group', { name: 'Period' });
}

/** The hidden data table of a chart, as rows of text: [label, ...values]. */
function chartRows(chart: string): string[][] {
  const table = screen.getByRole('table', { name: `${chart} (data table)` });
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => Array.from(row.children).map((cell) => cell.textContent ?? ''));
}

function paymentRows(): string[][] {
  const table = screen.getByRole('table', { name: 'Payments' });
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent ?? ''),
    );
}

async function loaded() {
  await screen.findByRole('table', { name: 'Payments' });
}

describe('OperatorAnalyticsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation(analyticsGet({ meta: threeDayMeta() }));
  });

  it('OperatorAnalyticsSection: changing the period refetches with the new period', async () => {
    const user = userEvent.setup();
    renderSection();

    // Its own picker, starting on 30 days.
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(PATH, { params: { period: '30d' } }),
    );
    expect(within(periodGroup()).getByRole('button', { name: '30 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await loaded();
    expect(mockGet).toHaveBeenCalledTimes(1);

    await user.click(within(periodGroup()).getByRole('button', { name: '3 months' }));
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(PATH, { params: { period: '3m' } }),
    );
    expect(within(periodGroup()).getByRole('button', { name: '3 months' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(mockGet).toHaveBeenCalledTimes(2);

    await user.click(within(periodGroup()).getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-10' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(PATH, {
        params: { from: '2026-11-01', to: '2026-11-10' },
      }),
    );
    expect(mockGet).toHaveBeenCalledTimes(3);
  });

  it('draws cards per day and sales per day, and lists the payments with the total paid', async () => {
    renderSection();
    await loaded();

    expect(screen.getByRole('img', { name: CARDS_CHART })).toBeInTheDocument();
    expect(chartRows(CARDS_CHART)).toEqual([
      ['13 Nov', '40', '31'],
      ['14 Nov', '0', '28'],
      ['15 Nov', '60', '12'],
    ]);
    const cardsTable = screen.getByRole('table', { name: `${CARDS_CHART} (data table)` });
    expect(
      within(cardsTable)
        .getAllByRole('columnheader')
        .slice(1)
        .map((h) => h.textContent),
    ).toEqual(['Created', 'Used']);

    expect(screen.getByRole('img', { name: SALES_CHART })).toBeInTheDocument();
    expect(chartRows(SALES_CHART)).toEqual([
      ['13 Nov', 'SDG 15,500'],
      ['14 Nov', 'SDG 14,000'],
      ['15 Nov', 'SDG 6,000'],
    ]);
    expect(screen.getByText("Operator's own sales, not Wasel income")).toBeInTheDocument();

    // The totals of the period sit beside each chart's title.
    expect(screen.getByRole('heading', { level: 4, name: CARDS_CHART }).parentElement).toHaveTextContent(
      /Created 100 · Used 71$/,
    );
    expect(screen.getByRole('heading', { level: 4, name: SALES_CHART }).parentElement).toHaveTextContent(
      /Total SDG 35,500$/,
    );

    // Every payment, whatever its status, newest first as delivered.
    expect(paymentRows()).toEqual([
      ['12/11/2026, 10:00', 'Pro', 'SDG 90,000', 'Pending', '—'],
      ['10/10/2026, 10:00', 'Pro', 'SDG 90,000', 'Approved', '10/10/2026, 14:00'],
      ['02/09/2026, 10:00', 'Starter', 'SDG 45,000', 'Rejected', '03/09/2026, 12:30'],
    ]);
    expect(screen.getByText('Total paid').parentElement).toHaveTextContent(
      /^Total paid\s*SDG 90,000$/,
    );

    expect(screen.getByText('Figures as of 15 Nov 2026, 12:20')).toBeInTheDocument();
    // The whole period is inside the use history: nothing to explain.
    expect(screen.queryByText(/Use history begins on/)).not.toBeInTheDocument();
  });

  it('gives every day of the period a column, with zeros for the days the API left out', async () => {
    mockGet.mockImplementation(
      analyticsGet({
        meta: metaFixture({
          period: 'custom',
          range: { from: '2026-11-11', to: '2026-11-15' },
          previous: { from: '2026-11-06', to: '2026-11-10' },
        }),
      }),
    );
    renderSection();
    await loaded();

    expect(chartRows(CARDS_CHART)).toEqual([
      ['11 Nov', '0', '0'],
      ['12 Nov', '0', '0'],
      ['13 Nov', '40', '31'],
      ['14 Nov', '0', '28'],
      ['15 Nov', '60', '12'],
    ]);
    expect(chartRows(SALES_CHART).map((row) => row[0])).toEqual([
      '11 Nov',
      '12 Nov',
      '13 Nov',
      '14 Nov',
      '15 Nov',
    ]);
  });

  it('says when the period starts before the use history', async () => {
    // 30 days back from 15 Nov starts on 17 Oct; use history starts on 20 Oct.
    mockGet.mockImplementation(
      analyticsGet({
        meta: metaFixture({
          period: '30d',
          range: { from: '2026-10-17', to: '2026-11-15' },
          previous: { from: '2026-09-17', to: '2026-10-16' },
        }),
      }),
    );
    renderSection();
    await loaded();

    expect(screen.getByText(/Use history begins on 20 Oct 2026/)).toBeInTheDocument();

    const rows = chartRows(CARDS_CHART);
    expect(rows).toHaveLength(30);
    // Cards created are known for every day. Cards used have no figure before
    // the history starts, which is not the same as zero.
    expect(rows.slice(0, 4)).toEqual([
      ['17 Oct', '0', 'No data'],
      ['18 Oct', '0', 'No data'],
      ['19 Oct', '0', 'No data'],
      ['20 Oct', '0', '0'],
    ]);
    expect(rows[29]).toEqual(['15 Nov', '60', '12']);
  });

  it('shows empty blocks and no NaN when nothing is recorded', async () => {
    mockGet.mockImplementation(
      analyticsGet({ operator: emptyOperatorFixture(), meta: emptyMetaFixture() }),
    );
    const { container } = renderSection();

    expect(await screen.findByText('No payments yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Payments' })).not.toBeInTheDocument();
    expect(screen.getByText('Total paid').parentElement).toHaveTextContent(/SDG 0$/);

    // Both charts keep their place, with nothing drawn.
    expect(container.querySelectorAll('[data-chart-empty]')).toHaveLength(2);
    expect(screen.getByRole('img', { name: CARDS_CHART })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: SALES_CHART })).toBeInTheDocument();
    expect(container.querySelector('[data-chart]')).toBeNull();

    expect(screen.getByText('No figures yet')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|Infinity|undefined|null/);
  });

  it('treats a period of zeros as nothing to draw', async () => {
    mockGet.mockImplementation(
      analyticsGet({
        operator: operatorFixture({
          daily: [
            { day: '2026-11-13', cardsCreated: 0, cardsUsed: 0, salesValue: 0 },
            { day: '2026-11-14', cardsCreated: 0, cardsUsed: 0, salesValue: 0 },
          ],
        }),
        meta: threeDayMeta(),
      }),
    );
    const { container } = renderSection();
    await loaded();

    expect(container.querySelectorAll('[data-chart-empty]')).toHaveLength(2);
  });

  it('draws the cards chart alone when cards were created but none used', async () => {
    mockGet.mockImplementation(
      analyticsGet({
        operator: operatorFixture({
          daily: [{ day: '2026-11-14', cardsCreated: 25, cardsUsed: 0, salesValue: 0 }],
        }),
        meta: threeDayMeta(),
      }),
    );
    const { container } = renderSection();
    await loaded();

    expect(chartRows(CARDS_CHART)).toEqual([
      ['13 Nov', '0', '0'],
      ['14 Nov', '25', '0'],
      ['15 Nov', '0', '0'],
    ]);
    // No sales: that chart shows its empty block.
    expect(container.querySelectorAll('[data-chart-empty]')).toHaveLength(1);
    expect(screen.getByRole('img', { name: SALES_CHART })).toHaveAttribute('data-chart-empty');
  });

  it('shows ErrorPanel and refetches on retry', async () => {
    const user = userEvent.setup();
    mockGet.mockImplementationOnce(() =>
      Promise.reject({ response: { data: { error: { message: 'User not found' } } } }),
    );
    renderSection();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to load data');
    expect(alert).toHaveTextContent('User not found');
    expect(screen.queryByRole('table', { name: 'Payments' })).not.toBeInTheDocument();
    // The picker stays usable: another period may well load.
    expect(periodGroup()).toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));

    await loaded();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous charts on screen, dimmed, while a new period loads', async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => {};
    renderSection();
    await loaded();

    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await user.click(within(periodGroup()).getByRole('button', { name: '12 months' }));

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    const chart = screen.getByRole('img', { name: CARDS_CHART });
    expect(chart.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
    expect(chartRows(CARDS_CHART)).toHaveLength(3);

    release(
      analyticsResponse(
        operatorFixture({
          daily: [{ day: '2026-11-15', cardsCreated: 7, cardsUsed: 3, salesValue: 1_500 }],
        }),
        threeDayMeta(),
      ),
    );
    await waitFor(() =>
      expect(chartRows(CARDS_CHART)).toEqual([
        ['13 Nov', '0', '0'],
        ['14 Nov', '0', '0'],
        ['15 Nov', '7', '3'],
      ]),
    );
    expect(
      screen.getByRole('img', { name: CARDS_CHART }).closest('[aria-busy]'),
    ).toHaveAttribute('aria-busy', 'false');
  });

  it("never shows one operator's figures under another operator", async () => {
    const client = newClient();
    let release: (value: unknown) => void = () => {};
    const view = render(tree(client, 'u-nile'));
    await loaded();

    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    view.rerender(tree(client, 'u-atbara'));

    await waitFor(() =>
      expect(mockGet).toHaveBeenLastCalledWith('/admin/analytics/operators/u-atbara', {
        params: { period: '30d' },
      }),
    );
    // Cafe Nile's payments and charts are gone while Atbara's load.
    expect(screen.queryByRole('table', { name: 'Payments' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: CARDS_CHART })).not.toBeInTheDocument();

    release(
      analyticsResponse(operatorFixture({ payments: [], totalPaid: 0 }), threeDayMeta()),
    );
    expect(await screen.findByText('No payments yet.')).toBeInTheDocument();
  });
});
