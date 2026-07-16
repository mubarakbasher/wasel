import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the axios wrapper: control the history list + capture the broadcast POST.
vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import api from '../../lib/api';
import { ToastProvider } from '../../hooks/useToast';
import AnnouncementsPage from '../AnnouncementsPage';

const mockGet = api.get as unknown as Mock;
const mockPost = api.post as unknown as Mock;

const announcement = {
  id: 'a_1',
  titleEn: 'Scheduled maintenance',
  titleAr: 'صيانة مجدولة',
  bodyEn: 'We will be down at midnight.',
  bodyAr: 'سنكون غير متاحين في منتصف الليل.',
  audience: 'active_operators',
  recipientCount: 42,
  pushSuccessCount: 12,
  pushFailureCount: 1,
  createdAt: '2026-07-15T10:00:00.000Z',
  adminName: 'Admin One',
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
        <AnnouncementsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Title (English)'), 'Hello');
  await user.type(screen.getByLabelText('Title (Arabic)'), 'مرحبا');
  await user.type(screen.getByLabelText('Body (English)'), 'Body text');
  await user.type(screen.getByLabelText('Body (Arabic)'), 'نص الإعلان');
}

describe('AnnouncementsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { data: [announcement], meta: { total: 1 } } });
    mockPost.mockResolvedValue({ data: { success: true, data: { id: 'a_new', recipientCount: 42 } } });
  });

  it('renders history rows with title (EN + AR) and push counts', async () => {
    renderPage();
    expect(await screen.findByText('Scheduled maintenance')).toBeInTheDocument();
    expect(screen.getByText('صيانة مجدولة')).toBeInTheDocument();
    expect(screen.getByText('Admin One')).toBeInTheDocument();
    expect(screen.getByText('12 ok / 1 failed')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/admin/announcements', {
      params: { page: 1, limit: 20 },
    });
  });

  it('sends a valid announcement: POSTs the 4 fields and toasts the recipient count', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Scheduled maintenance');

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Send announcement' }));

    // Confirm dialog gates the broadcast.
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Send' }));

    expect(mockPost).toHaveBeenCalledWith('/admin/announcements', {
      titleEn: 'Hello',
      titleAr: 'مرحبا',
      bodyEn: 'Body text',
      bodyAr: 'نص الإعلان',
    });
    expect(await screen.findByText('Announcement sent to 42 operators.')).toBeInTheDocument();
  });

  it('blocks submit when the Arabic title is blank (client validation)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Scheduled maintenance');

    // Fill everything except Title (Arabic).
    await user.type(screen.getByLabelText('Title (English)'), 'Hello');
    await user.type(screen.getByLabelText('Body (English)'), 'Body text');
    await user.type(screen.getByLabelText('Body (Arabic)'), 'نص الإعلان');

    await user.click(screen.getByRole('button', { name: 'Send announcement' }));

    expect(await screen.findByText('Title (Arabic) is required.')).toBeInTheDocument();
    // No confirm dialog opened and nothing was broadcast.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('surfaces the backend error message when the broadcast fails', async () => {
    const user = userEvent.setup();
    mockPost.mockRejectedValueOnce({
      response: {
        data: { success: false, error: { message: 'Push service unavailable', code: 'PUSH_DOWN' } },
      },
    });
    renderPage();
    await screen.findByText('Scheduled maintenance');

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Send announcement' }));
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Push service unavailable')).toBeInTheDocument();
  });
});
