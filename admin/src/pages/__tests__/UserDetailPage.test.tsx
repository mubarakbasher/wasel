import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Mock the axios wrapper: answer the user, analytics and setup-guide requests
// and capture the verify PUT and the create-router POST.
vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
  resolveAssetUrl: (p: string | null | undefined) => p ?? null,
}));

import api from '../../lib/api';
import type { AnalyticsMeta, OperatorAnalytics } from '../../lib/analytics';
import { analyticsResponse, metaFixture, operatorFixture } from '../../tests/analyticsFixtures';
import UserDetailPage from '../UserDetailPage';

const mockGet = api.get as unknown as Mock;
const mockPut = api.put as unknown as Mock;
const mockPost = api.post as unknown as Mock;

const USER_PATH = '/admin/users/u-nile';
const ANALYTICS_PATH = '/admin/analytics/operators/u-nile';

function userDetail() {
  return {
    user: {
      id: 'u-nile',
      name: 'Cafe Nile',
      email: 'nile@example.com',
      phone: '+249 912 000 000',
      business_name: 'Cafe Nile Ltd',
      role: 'user',
      is_verified: true,
      is_active: true,
      created_at: '2026-06-01T08:00:00.000Z',
    },
    subscription: {
      id: 'sub-1',
      planTier: 'pro',
      planName: 'Pro',
      status: 'active',
      startDate: '2026-10-20T08:00:00.000Z',
      endDate: '2026-11-20T08:00:00.000Z',
      voucherQuota: 5000,
      vouchersUsed: 1200,
      daysRemaining: 5,
      maxRouters: 3,
    },
    // The same router ids the operator analytics fixture reports on.
    routers: [
      {
        id: 'r-3',
        name: 'Cafe Nile Main',
        status: 'online',
        tunnel_ip: '10.10.0.10',
        created_at: '2026-06-02T08:00:00.000Z',
      },
      {
        id: 'r-4',
        name: 'Cafe Nile Roof',
        status: 'offline',
        tunnel_ip: null,
        created_at: '2026-06-03T08:00:00.000Z',
      },
    ],
    routerCount: 2,
  };
}

type Detail = ReturnType<typeof userDetail>;

const setupGuide = {
  routerName: 'Cafe Nile Main',
  setupGuide: '/interface wireguard add name=wasel',
  tunnelIp: '10.10.0.10',
  serverEndpoint: 'vpn.example.com:51820',
  steps: [],
};

interface ApiOptions {
  detail?: Detail;
  /** The operator analytics answer; `fail` makes the request reject with that value. */
  analytics?: OperatorAnalytics | { fail: unknown };
  meta?: Partial<AnalyticsMeta>;
}

function apiGet({ detail = userDetail(), analytics = operatorFixture(), meta = {} }: ApiOptions = {}) {
  return async (url: string) => {
    if (url === USER_PATH) return { data: { success: true, data: detail } };
    if (url === ANALYTICS_PATH) {
      if ('fail' in analytics) throw analytics.fail;
      return analyticsResponse(
        analytics,
        metaFixture({
          period: '30d',
          // Router history (10 Nov in the fixture) is older than this period.
          range: { from: '2026-11-13', to: '2026-11-15' },
          previous: { from: '2026-11-10', to: '2026-11-12' },
          ...meta,
        }),
      );
    }
    if (/^\/admin\/routers\/[^/]+\/setup-guide$/.test(url)) {
      return { data: { success: true, data: setupGuide } };
    }
    throw new Error(`UserDetailPage test: no fixture for ${url}`);
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/users/u-nile']}>
        <Routes>
          <Route path="/users/:id" element={<UserDetailPage />} />
          <Route path="/users" element={<p>Users list</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function analyticsCalls(): unknown[][] {
  return mockGet.mock.calls.filter(([url]) => String(url).startsWith('/admin/analytics/'));
}

function routerCells(name: string): string[] {
  const row = screen.getByText(name).closest('tr') as HTMLElement;
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent ?? '');
}

async function loaded() {
  await screen.findByRole('heading', { level: 2, name: 'Cafe Nile' });
}

describe('UserDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation(apiGet());
    mockPut.mockResolvedValue({ data: { success: true } });
    mockPost.mockResolvedValue({ data: { success: true, data: { id: 'r-new' } } });
  });

  it('UserDetailPage still renders its existing cards when the analytics request fails', async () => {
    const user = userEvent.setup();
    mockGet.mockImplementation(
      apiGet({
        analytics: {
          fail: { response: { data: { error: { message: 'Analytics unavailable' } } } },
        },
      }),
    );
    renderPage();
    await loaded();

    // The failure is shown in the analytics section, with its own retry.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Analytics unavailable');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    // User card.
    expect(screen.getByText('Cafe Nile Ltd')).toBeInTheDocument();
    expect(screen.getByText('+249 912 000 000')).toBeInTheDocument();

    // Subscription card.
    expect(screen.getByRole('heading', { level: 3, name: 'Subscription' })).toBeInTheDocument();
    expect(screen.getByText('20/11/2026')).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByText('1,200 / 5,000')).toBeInTheDocument();

    // Routers card: both rows, with nothing to say about uptime and drops.
    expect(screen.getByRole('heading', { level: 3, name: 'Routers' })).toBeInTheDocument();
    expect(routerCells('Cafe Nile Main').slice(0, 6)).toEqual([
      'Cafe Nile Main',
      'Online',
      '—',
      '—',
      '10.10.0.10',
      '02/06/2026',
    ]);
    expect(routerCells('Cafe Nile Roof').slice(0, 6)).toEqual([
      'Cafe Nile Roof',
      'Offline',
      '—',
      '—',
      '—',
      '03/06/2026',
    ]);
    expect(screen.getAllByRole('button', { name: 'View setup' })).toHaveLength(2);
    expect(screen.getByText('Uptime and drops could not be loaded.')).toBeInTheDocument();

    // The actions are still there and still work.
    await user.click(screen.getByRole('button', { name: 'Add router' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add router' });
    expect(within(dialog).getByRole('button', { name: 'Create router' })).toBeDisabled();
  });

  it('UserDetailPage shows "Unlimited" for a -1 quota', async () => {
    const detail = userDetail();
    detail.subscription.voucherQuota = -1;
    mockGet.mockImplementation(apiGet({ detail }));
    renderPage();
    await loaded();

    expect(screen.getByText('1,200 / Unlimited')).toBeInTheDocument();
    expect(screen.queryByText(/-1/)).not.toBeInTheDocument();
  });

  it('merges uptime and drops into the routers table from one analytics request', async () => {
    renderPage();
    await loaded();

    await waitFor(() => expect(routerCells('Cafe Nile Main')[2]).toBe('99.6%'));
    const routersTable = screen.getByText('Cafe Nile Main').closest('table') as HTMLElement;
    expect(
      within(routersTable)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Name', 'Status', 'Uptime', 'Drops', 'Tunnel IP', 'Created', 'Actions']);

    const main = routerCells('Cafe Nile Main');
    expect(main[3]).toContain('1');
    expect(main[3]).toContain('longest 6 min');

    // Never seen online since recording began: no uptime figure, no drops.
    const roof = routerCells('Cafe Nile Roof');
    expect(roof[2]).toBe('—');
    expect(roof[3]).toBe('0');

    // Router history covers the whole period: only the period is named.
    expect(screen.getByText('Uptime and drops cover the last 30 days.')).toBeInTheDocument();
    // The table scrolls sideways instead of clipping its new columns.
    expect(routersTable.parentElement).toHaveClass('overflow-x-auto');

    // The table and the section below it share one request.
    expect(analyticsCalls()).toEqual([[ANALYTICS_PATH, { params: { period: '30d' } }]]);
  });

  it('says when router history is younger than the period, or has not begun', async () => {
    mockGet.mockImplementation(
      apiGet({ meta: { range: { from: '2026-10-17', to: '2026-11-15' } } }),
    );
    const view = renderPage();
    await loaded();
    expect(
      await screen.findByText(
        'Uptime and drops cover the last 30 days. Router history began on 10 Nov 2026.',
      ),
    ).toBeInTheDocument();
    view.unmount();

    mockGet.mockImplementation(apiGet({ meta: { routerHistoryStart: null } }));
    renderPage();
    await loaded();
    expect(
      await screen.findByText(
        'Uptime and drops cover the last 30 days. Router uptime starts recording at launch.',
      ),
    ).toBeInTheDocument();
  });

  it('shows "—" for a router the analytics do not know yet', async () => {
    mockGet.mockImplementation(
      apiGet({
        analytics: operatorFixture({
          routers: [{ routerId: 'r-3', uptimePct: 100, drops: 0, longestOutageSec: 0 }],
        }),
      }),
    );
    renderPage();
    await loaded();

    await waitFor(() => expect(routerCells('Cafe Nile Main')[2]).toBe('100.0%'));
    expect(routerCells('Cafe Nile Main')[3]).toBe('0');
    expect(routerCells('Cafe Nile Roof').slice(2, 4)).toEqual(['—', '—']);
  });

  it('adds the analytics section after the Routers card', async () => {
    renderPage();
    await loaded();

    const section = await screen.findByRole('heading', { level: 3, name: 'Cards and sales' });
    const routers = screen.getByRole('heading', { level: 3, name: 'Routers' });
    expect(
      routers.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(
      await screen.findByRole('img', { name: 'Cards created and used per day' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Payments' })).toBeInTheDocument();
    expect(screen.getByText('Total paid')).toBeInTheDocument();
  });

  it('does not ask for analytics of an account that is not an operator', async () => {
    const detail = userDetail();
    detail.user.role = 'admin';
    mockGet.mockImplementation(apiGet({ detail }));
    renderPage();
    await loaded();

    expect(screen.getByRole('heading', { level: 3, name: 'Routers' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cards and sales' })).not.toBeInTheDocument();
    expect(routerCells('Cafe Nile Main').slice(2, 4)).toEqual(['—', '—']);
    expect(analyticsCalls()).toEqual([]);
  });

  it('verifies a user and reports it', async () => {
    const user = userEvent.setup();
    const detail = userDetail();
    detail.user.is_verified = false;
    mockGet.mockImplementation(apiGet({ detail }));
    renderPage();
    await loaded();

    await user.click(screen.getByRole('button', { name: 'Verify user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Verify user' });
    await user.click(within(dialog).getByRole('button', { name: 'Verify user' }));

    expect(mockPut).toHaveBeenCalledWith(USER_PATH, { is_verified: true });
    expect(await screen.findByText('User verified.')).toBeInTheDocument();
  });

  it('shows the API message when verifying fails, and a fallback when there is none', async () => {
    const user = userEvent.setup();
    const detail = userDetail();
    detail.user.is_verified = false;
    mockGet.mockImplementation(apiGet({ detail }));
    mockPut.mockRejectedValueOnce({
      response: { data: { success: false, error: { message: 'Already verified' } } },
    });
    renderPage();
    await loaded();

    await user.click(screen.getByRole('button', { name: 'Verify user' }));
    let dialog = await screen.findByRole('dialog', { name: 'Verify user' });
    await user.click(within(dialog).getByRole('button', { name: 'Verify user' }));
    expect(await screen.findByText('Already verified')).toBeInTheDocument();

    mockPut.mockRejectedValueOnce({});
    dialog = screen.getByRole('dialog', { name: 'Verify user' });
    await user.click(within(dialog).getByRole('button', { name: 'Verify user' }));
    expect(await screen.findByText('Verify failed')).toBeInTheDocument();
  });

  it('opens the setup script of a router', async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();

    await user.click(screen.getAllByRole('button', { name: 'View setup' })[0]);

    const dialog = await screen.findByRole('dialog', { name: 'Setup script' });
    expect(await within(dialog).findByText('/interface wireguard add name=wasel')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/admin/routers/r-3/setup-guide');
  });

  it('creates a router and shows its setup script', async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();

    await user.click(screen.getByRole('button', { name: 'Add router' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add router' });
    await user.type(within(dialog).getAllByRole('textbox')[0], 'Garden AP');
    await user.click(within(dialog).getByRole('button', { name: 'Create router' }));

    expect(mockPost).toHaveBeenCalledWith('/admin/users/u-nile/routers', { name: 'Garden AP' });
    expect(
      await screen.findByRole('dialog', { name: 'Router created — setup script' }),
    ).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/admin/routers/r-new/setup-guide');
  });

  it('shows the API message when creating a router fails, and a fallback when there is none', async () => {
    const user = userEvent.setup();
    mockPost.mockRejectedValueOnce({
      response: { data: { success: false, error: { message: 'Router limit reached' } } },
    });
    renderPage();
    await loaded();

    await user.click(screen.getByRole('button', { name: 'Add router' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add router' });
    await user.type(within(dialog).getAllByRole('textbox')[0], 'Garden AP');
    await user.click(within(dialog).getByRole('button', { name: 'Create router' }));
    expect(await within(dialog).findByText('Router limit reached')).toBeInTheDocument();

    mockPost.mockRejectedValueOnce({});
    await user.click(within(dialog).getByRole('button', { name: 'Create router' }));
    expect(await within(dialog).findByText('Request failed')).toBeInTheDocument();
  });

  it('goes back to the users list', async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();

    await user.click(screen.getByRole('button', { name: 'Back to users' }));
    expect(await screen.findByText('Users list')).toBeInTheDocument();
  });
});
