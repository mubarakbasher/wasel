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

function newQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(queryClient: QueryClient = newQueryClient()) {
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

  it('PaymentsPage: the table has an Approved column', async () => {
    const approved = {
      ...pendingPayment,
      id: 'pay_2',
      user_name: 'Omar Ali',
      status: 'approved',
      reviewed_at: '2026-07-02T09:30:00.000Z',
    };
    const rejected = {
      ...pendingPayment,
      id: 'pay_3',
      user_name: 'Sara Osman',
      status: 'rejected',
      rejection_reason: 'Blurry receipt',
      reviewed_at: '2026-07-03T08:00:00.000Z',
    };
    mockGet.mockResolvedValue({
      data: { data: [approved, pendingPayment, rejected], meta: { total: 3 } },
    });
    renderPage();
    await screen.findByText('Omar Ali');

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    const column = headers.indexOf('Approved');
    // Right after the day the payment was made, so the two can be read together.
    expect(headers[column - 1]).toBe('Date');
    const approvedCell = (name: string) =>
      within(screen.getByText(name).closest('tr') as HTMLElement).getAllByRole('cell')[column];

    // 09:30 UTC on the admin (Khartoum) clock.
    expect(approvedCell('Omar Ali')).toHaveTextContent('02/07/2026, 11:30');
    // Not reviewed yet.
    expect(approvedCell('Jane Doe')).toHaveTextContent(/^—$/);
    // Reviewed, but rejected: it was never approved, so it has no approval time.
    expect(approvedCell('Sara Osman')).toHaveTextContent(/^—$/);
  });

  it('a decision also marks the Money analytics as out of date', async () => {
    const user = userEvent.setup();
    const queryClient = newQueryClient();
    const moneyKey = ['admin', 'analytics', 'money', 'month'];
    const operatorsKey = ['admin', 'analytics', 'operators', '30d'];
    queryClient.setQueryData(moneyKey, { data: {}, meta: {} });
    queryClient.setQueryData(operatorsKey, { data: {}, meta: {} });
    renderPage(queryClient);
    await screen.findByText('Jane Doe');

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Payment approved successfully.')).toBeInTheDocument();

    // Income is counted from approved payments: every cached Money period is stale now.
    expect(queryClient.getQueryState(moneyKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(operatorsKey)?.isInvalidated).toBe(false);
  });
});
