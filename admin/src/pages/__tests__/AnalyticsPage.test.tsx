import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

// Mock the axios wrapper: answer the analytics endpoints and capture the calls.
vi.mock('../../lib/api', () => ({
  default: { get: vi.fn() },
  resolveAssetUrl: (p: string | null | undefined) => p ?? null,
}));

import api from '../../lib/api';
import { ToastProvider } from '../../hooks/useToast';
import { analyticsGet } from '../../tests/analyticsFixtures';
import AnalyticsPage from '../AnalyticsPage';

const mockGet = api.get as unknown as Mock;

/** Prints the router location so a test can read where the page ended up. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname + search}</output>;
}

// The same two routes App.tsx registers inside the protected block.
function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/analytics/:tab" element={<AnalyticsPage />} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function currentUrl(): { pathname: string; params: Record<string, string> } {
  const text = screen.getByTestId('location').textContent ?? '';
  const [pathname, search = ''] = text.split('?');
  return { pathname, params: Object.fromEntries(new URLSearchParams(search)) };
}

function tabsNav(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Analytics sections' });
}

function periodGroup(): HTMLElement {
  return screen.getByRole('group', { name: 'Period' });
}

describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation(analyticsGet());
  });

  it('AnalyticsPage: /analytics redirects to /analytics/money', async () => {
    renderAt('/analytics');

    await waitFor(() => expect(currentUrl().pathname).toBe('/analytics/money'));
    expect(within(tabsNav()).getByRole('link', { name: 'Money' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/money', {
        params: { period: 'month' },
      }),
    );
  });

  it('the redirect keeps the period of the link it came from', async () => {
    renderAt('/analytics?period=12m');

    await waitFor(() => expect(currentUrl().pathname).toBe('/analytics/money'));
    expect(currentUrl().params).toEqual({ period: '12m' });
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/money', {
        params: { period: '12m' },
      }),
    );
  });

  it('an unknown tab redirects to money', async () => {
    renderAt('/analytics/secrets');

    await waitFor(() => expect(currentUrl().pathname).toBe('/analytics/money'));
    expect(within(tabsNav()).getByRole('link', { name: 'Money' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows the three tabs as links inside a nav, with the open one marked', async () => {
    renderAt('/analytics/network');

    const links = within(tabsNav()).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Money', 'Operators', 'Network and cards']);
    expect(links[2]).toHaveAttribute('aria-current', 'page');
    expect(links[0]).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/network', {
        params: { period: '30d' },
      }),
    );
  });

  it('AnalyticsPage: the period from the URL reaches the API call', async () => {
    renderAt('/analytics/money?period=3m');

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/money', {
        params: { period: '3m' },
      }),
    );
    expect(within(periodGroup()).getByRole('button', { name: '3 months' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('a custom range from the URL reaches the API call', async () => {
    renderAt('/analytics/network?from=2026-11-01&to=2026-11-10');

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/network', {
        params: { from: '2026-11-01', to: '2026-11-10' },
      }),
    );
    expect(within(periodGroup()).getByRole('button', { name: 'Custom' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('a preset the tab does not offer falls back to the first one of the tab', async () => {
    renderAt('/analytics/operators?period=month');

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/operators', {
        params: { period: '30d' },
      }),
    );
    expect(within(periodGroup()).getByRole('button', { name: '30 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('AnalyticsPage: switching tab keeps a shared preset and drops q, filter and sort', async () => {
    const user = userEvent.setup();
    renderAt('/analytics/money?period=3m&q=nile&filter=quiet&sort=operator&dir=desc');

    await user.click(within(tabsNav()).getByRole('link', { name: 'Operators' }));

    await waitFor(() => expect(currentUrl().pathname).toBe('/analytics/operators'));
    expect(currentUrl().params).toEqual({ period: '3m' });
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/operators', {
        params: { period: '3m' },
      }),
    );
    expect(within(periodGroup()).getByRole('button', { name: '3 months' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('switching tab drops a preset the new tab lacks', async () => {
    const user = userEvent.setup();
    renderAt('/analytics/money?period=month');

    await user.click(within(tabsNav()).getByRole('link', { name: 'Network and cards' }));

    await waitFor(() => expect(currentUrl().pathname).toBe('/analytics/network'));
    expect(currentUrl().params).toEqual({});
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/network', {
        params: { period: '30d' },
      }),
    );
  });

  it('switching tab keeps a custom range', async () => {
    const user = userEvent.setup();
    renderAt('/analytics/operators?from=2026-11-01&to=2026-11-10&q=nile');

    await user.click(within(tabsNav()).getByRole('link', { name: 'Money' }));

    await waitFor(() => expect(currentUrl().pathname).toBe('/analytics/money'));
    expect(currentUrl().params).toEqual({ from: '2026-11-01', to: '2026-11-10' });
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/money', {
        params: { from: '2026-11-01', to: '2026-11-10' },
      }),
    );
  });

  it('choosing a preset writes it to the URL, refetches, and keeps the table state of the tab', async () => {
    const user = userEvent.setup();
    renderAt('/analytics/operators?from=2026-11-01&to=2026-11-10&q=nile&sort=cardsUsed&dir=desc');

    await user.click(within(periodGroup()).getByRole('button', { name: '12 months' }));

    await waitFor(() =>
      expect(currentUrl().params).toEqual({
        period: '12m',
        q: 'nile',
        sort: 'cardsUsed',
        dir: 'desc',
      }),
    );
    expect(currentUrl().pathname).toBe('/analytics/operators');
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/operators', {
        params: { period: '12m' },
      }),
    );
  });

  it('applying a custom range writes from and to and drops the preset', async () => {
    const user = userEvent.setup();
    renderAt('/analytics/money?period=12m');

    await user.click(within(periodGroup()).getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(currentUrl().params).toEqual({ from: '2026-10-01', to: '2026-10-31' }),
    );
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/analytics/money', {
        params: { from: '2026-10-01', to: '2026-10-31' },
      }),
    );
  });
});
