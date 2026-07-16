import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the axios wrapper: control the router list + capture the reprovision/delete calls.
vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import api from '../../lib/api';
import { ToastProvider } from '../../hooks/useToast';
import RoutersPage from '../RoutersPage';

const mockGet = api.get as unknown as Mock;
const mockPost = api.post as unknown as Mock;
const mockDelete = api.delete as unknown as Mock;

const router = {
  id: 'r_1',
  name: 'Cafe Router',
  owner_name: 'Jane Doe',
  owner_email: 'jane@example.com',
  status: 'online',
  last_seen: '2026-07-15T10:00:00.000Z',
  tunnel_ip: '10.10.0.2',
  hotspot_template_id: 'tpl_1',
  created_at: '2026-07-01T10:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RoutersPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Open the per-row action menu and click one of its items. */
async function openMenuAndClick(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole('button', { name: 'Actions for Cafe Router' }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

describe('RoutersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { data: [router], meta: { total: 1 } } });
    mockPost.mockResolvedValue({ data: { data: {} } });
    mockDelete.mockResolvedValue({ data: {} });
  });

  it('lists routers and requests the list from the API', async () => {
    renderPage();
    expect(await screen.findByText('Cafe Router')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/admin/routers', {
      params: { page: 1, limit: 20 },
    });
  });

  it('reprovisions a router: fires POST and raises a success toast', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Cafe Router');

    await openMenuAndClick(user, 'Reprovision');
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Reprovision' }));

    expect(mockPost).toHaveBeenCalledWith('/admin/routers/r_1/reprovision', {});
    expect(await screen.findByText('Router reprovisioned.')).toBeInTheDocument();
  });

  it('shows an error toast when the template fails to re-apply on the device', async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValueOnce({ data: { data: { hotspotTemplateStatus: 'failed' } } });
    renderPage();
    await screen.findByText('Cafe Router');

    await openMenuAndClick(user, 'Reprovision');
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Reprovision' }));

    expect(mockPost).toHaveBeenCalledWith('/admin/routers/r_1/reprovision', {});
    expect(
      await screen.findByText(
        'Reprovisioned, but the hotspot template failed to re-apply on the router.',
      ),
    ).toBeInTheDocument();
  });

  it('surfaces the NO_TEMPLATE backend message in an error toast', async () => {
    const user = userEvent.setup();
    mockPost.mockRejectedValueOnce({
      response: {
        data: { success: false, error: { message: 'Router has no stored template', code: 'NO_TEMPLATE' } },
      },
    });
    renderPage();
    await screen.findByText('Cafe Router');

    await openMenuAndClick(user, 'Reprovision');
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Reprovision' }));

    expect(await screen.findByText('Router has no stored template')).toBeInTheDocument();
  });

  it('deletes a router: fires DELETE and raises a success toast', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Cafe Router');

    await openMenuAndClick(user, 'Delete');
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    expect(mockDelete).toHaveBeenCalledWith('/admin/routers/r_1');
    expect(await screen.findByText('Router deleted.')).toBeInTheDocument();
  });
});
