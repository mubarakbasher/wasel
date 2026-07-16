import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the axios wrapper: control the voucher list + capture the status/delete calls.
vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import api from '../../lib/api';
import { ToastProvider } from '../../hooks/useToast';
import VouchersPage from '../VouchersPage';

const mockGet = api.get as unknown as Mock;
const mockPut = api.put as unknown as Mock;
const mockDelete = api.delete as unknown as Mock;

const activeVoucher = {
  id: 'v_1',
  code: 'WIFI-ABC123',
  status: 'active',
  createdAt: '2026-07-01T10:00:00.000Z',
  router: { id: 'r_1', name: 'Cafe Router' },
  owner: { id: 'u_1', name: 'Jane Doe', email: 'jane@example.com' },
  dataUsedMb: 120,
};

const disabledVoucher = { ...activeVoucher, id: 'v_2', code: 'WIFI-DIS999', status: 'disabled' };

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
        <VouchersPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('VouchersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { data: [activeVoucher], meta: { total: 1 } } });
    mockPut.mockResolvedValue({ data: {} });
    mockDelete.mockResolvedValue({ data: {} });
  });

  it('lists vouchers and requests the list from the API', async () => {
    renderPage();
    expect(await screen.findByText('WIFI-ABC123')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/admin/vouchers', {
      params: { page: 1, limit: 20 },
    });
  });

  it('disables a voucher: sends {status:"disabled"} and raises a success toast', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('WIFI-ABC123');

    // Row click opens the detail modal.
    await user.click(screen.getByText('WIFI-ABC123'));
    const detail = await screen.findByRole('dialog');
    await user.click(within(detail).getByRole('button', { name: 'Disable' }));

    // Detail modal hands off to the confirm dialog.
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Disable' }));

    expect(mockPut).toHaveBeenCalledWith('/admin/vouchers/v_1', { status: 'disabled' });
    expect(await screen.findByText('Voucher disabled.')).toBeInTheDocument();
  });

  it('deletes a voucher: fires DELETE and raises a success toast', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('WIFI-ABC123');

    await user.click(screen.getByText('WIFI-ABC123'));
    const detail = await screen.findByRole('dialog');
    await user.click(within(detail).getByRole('button', { name: 'Delete' }));

    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    expect(mockDelete).toHaveBeenCalledWith('/admin/vouchers/v_1');
    expect(await screen.findByText('Voucher deleted.')).toBeInTheDocument();
  });

  it('shows the backend error message when re-enabling an exhausted voucher fails', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({ data: { data: [disabledVoucher], meta: { total: 1 } } });
    mockPut.mockRejectedValueOnce({
      response: { data: { success: false, error: { message: 'Voucher already exhausted', code: 'CONFLICT' } } },
    });
    renderPage();
    await screen.findByText('WIFI-DIS999');

    await user.click(screen.getByText('WIFI-DIS999'));
    const detail = await screen.findByRole('dialog');
    await user.click(within(detail).getByRole('button', { name: 'Enable' }));

    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Enable' }));

    expect(mockPut).toHaveBeenCalledWith('/admin/vouchers/v_2', { status: 'active' });
    expect(await screen.findByText('Voucher already exhausted')).toBeInTheDocument();
  });
});
