import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the axios wrapper: control the payments list + capture the decision PUT.
vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), put: vi.fn() },
  resolveAssetUrl: (p: string | null | undefined) => p ?? null,
}));

import api from '../../lib/api';
import { ToastProvider } from '../../hooks/useToast';
import PaymentsPage from '../PaymentsPage';

const mockGet = api.get as unknown as Mock;
const mockPut = api.put as unknown as Mock;

const pendingPayment = {
  id: 'pay_1',
  user_name: 'Jane Doe',
  user_email: 'jane@example.com',
  plan_tier: 'pro',
  plan_name: 'Pro',
  amount: 50,
  currency: 'SDG',
  reference_code: 'REF-123',
  receipt_url: null,
  rejection_reason: null,
  status: 'pending',
  created_at: '2026-07-01T10:00:00.000Z',
  reviewed_at: null,
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
        <PaymentsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('PaymentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { data: [pendingPayment], meta: { total: 1 } } });
    mockPut.mockResolvedValue({ data: {} });
  });

  it('loads pending payments and requests the list from the API', async () => {
    renderPage();
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/admin/payments', {
      params: { page: 1, limit: 20, status: 'pending' },
    });
  });

  it('approves a payment: sends the decision and raises a success toast', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Jane Doe');

    // Row action opens the confirm dialog.
    // Row action button is "Approve" (exact); the status tab is "approved".
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    expect(mockPut).toHaveBeenCalledWith('/admin/payments/pay_1', { decision: 'approved' });
    expect(await screen.findByText('Payment approved successfully.')).toBeInTheDocument();
  });

  it('rejects a payment with a reason: sends it and raises a success toast', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Jane Doe');

    // Row action button is "Reject" (exact); the status tab is "rejected".
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Blurry receipt');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));

    expect(mockPut).toHaveBeenCalledWith('/admin/payments/pay_1', {
      decision: 'rejected',
      rejection_reason: 'Blurry receipt',
    });
    expect(await screen.findByText('Payment rejected successfully.')).toBeInTheDocument();
  });

  it('raises an error toast when the decision call fails', async () => {
    const user = userEvent.setup();
    mockPut.mockRejectedValueOnce({
      response: { data: { success: false, error: { message: 'Already reviewed', code: 'CONFLICT' } } },
    });
    renderPage();
    await screen.findByText('Jane Doe');

    // Row action button is "Approve" (exact); the status tab is "approved".
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Already reviewed')).toBeInTheDocument();
  });
});
