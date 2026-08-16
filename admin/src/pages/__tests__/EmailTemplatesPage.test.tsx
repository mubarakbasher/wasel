import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EMAIL_TEMPLATES_KEY } from '../../lib/emailTemplates';

// Mock the axios wrapper: the fetched rows are the only source of the type rail.
vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
}));

import api from '../../lib/api';
import EmailTemplatesPage from '../EmailTemplatesPage';

const mockGet = api.get as unknown as Mock;
const mockPut = api.put as unknown as Mock;

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 't_1',
    type: 'verification_otp',
    language: 'en',
    subject: 'Your code',
    body_html: '<p>Hello {name}</p>',
    is_active: true,
    is_editable: true,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    placeholders: ['{name}', '{otp}'],
    ...overrides,
  };
}

// Mirrors staging: 7 types x 2 languages, support templates included.
const rows = [
  template(),
  template({ id: 't_2', language: 'ar' }),
  template({ id: 't_3', type: 'payment_approved', placeholders: ['{name}', '{plan}'] }),
  template({
    id: 't_4',
    type: 'support_message_admin',
    placeholders: ['{user_name}', '{message}'],
  }),
  template({ id: 't_5', type: 'support_reply_user', placeholders: ['{name}', '{reply}'] }),
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <EmailTemplatesPage />
      </QueryClientProvider>,
    ),
  };
}

describe('EmailTemplatesPage type rail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { data: rows } });
  });

  it('derives the rail from the fetched rows, including the support types', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: 'Verification OTP' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payment Approved' })).toBeInTheDocument();
    // The regression: these two rows were fetched but rendered by nothing.
    expect(screen.getByRole('button', { name: 'Support Message (Admin)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Support Reply (User)' })).toBeInTheDocument();
  });

  it('renders an unrecognised backend type with a humanized label, last in the rail', async () => {
    mockGet.mockResolvedValue({
      data: { data: [...rows, template({ id: 't_9', type: 'invoice_overdue' })] },
    });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Invoice Overdue' })).toBeInTheDocument();

    // Known types keep their curated order; unknown ones are appended.
    const rail = screen.getByRole('list');
    const labels = Array.from(rail.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual([
      'Verification OTP',
      'Payment Approved',
      'Support Message (Admin)',
      'Support Reply (User)',
      'Invoice Overdue',
    ]);
  });

  it('selects the first available type once the catalogue loads', async () => {
    renderPage();

    const first = await screen.findByRole('button', { name: 'Verification OTP' });
    expect(first.className).toContain('bg-blue-600');
    expect(screen.getByDisplayValue('Your code')).toBeInTheDocument();
  });

  it('renders placeholder chips from the row, and switches them with the type', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('button', { name: '{otp}' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Support Message (Admin)' }));

    expect(await screen.findByRole('button', { name: '{message}' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '{otp}' })).not.toBeInTheDocument();
  });

  it('renders no chips when the row omits placeholders', async () => {
    mockGet.mockResolvedValue({
      data: { data: [template({ placeholders: undefined })] },
    });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Verification OTP' })).toBeInTheDocument();
    expect(screen.queryByText('Available placeholders')).not.toBeInTheDocument();
  });

  it('renders without crashing when there are no templates at all', async () => {
    mockGet.mockResolvedValue({ data: { data: [] } });
    renderPage();

    expect(await screen.findByText('Email Templates')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('EmailTemplatesPage save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPut.mockResolvedValue({ data: { data: {} } });
  });

  it('percent-encodes the path segments so a type cannot retarget the PUT', async () => {
    const user = userEvent.setup();
    // email_templates.type is VARCHAR(64) with no CHECK, so treat it as untrusted.
    mockGet.mockResolvedValue({ data: { data: [template({ type: 'evil/../users' })] } });
    renderPage();

    await user.type(await screen.findByDisplayValue('Your code'), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Template saved.')).toBeInTheDocument();
    expect(mockPut).toHaveBeenCalledWith(
      '/admin/email-templates/evil%2F..%2Fusers/en',
      expect.anything(),
    );
  });
});

// The editor seeds its form from the fetched row, so it has to tell a selection
// change (reseed) apart from a refetch of the same selection (leave the form
// alone). Rows for catalogue types with no DB row arrive with a synthetic
// `default:<type>:<lang>` id that turns into a UUID on the first save, so the id
// cannot be the thing it keys off.
describe('EmailTemplatesPage form seeding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPut.mockResolvedValue({ data: { data: {} } });
  });

  it('reseeds the form when the language changes', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({
      data: { data: [template(), template({ id: 't_2', language: 'ar', subject: 'رمز التحقق' })] },
    });
    renderPage();

    await user.type(await screen.findByDisplayValue('Your code'), ' draft');
    await user.click(screen.getByRole('button', { name: 'AR' }));

    expect(await screen.findByDisplayValue('رمز التحقق')).toBeInTheDocument();
  });

  it('keeps unsaved edits when a background refetch returns the same selection', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({ data: { data: [template()] } });
    const { queryClient } = renderPage();

    await user.type(await screen.findByDisplayValue('Your code'), ' draft');

    mockGet.mockResolvedValue({
      data: {
        data: [template({ subject: 'Saved elsewhere', updated_at: '2026-08-02T10:00:00.000Z' })],
      },
    });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: EMAIL_TEMPLATES_KEY });
    });

    // The refetch landed (the meta line moved to the new timestamp)...
    expect(await screen.findByText(/Last updated 02\/08\/2026/)).toBeInTheDocument();
    // ...and left the in-progress edit alone.
    expect(screen.getByDisplayValue('Your code draft')).toBeInTheDocument();
  });

  it('keeps edits typed while the first save of a synthetic row is in flight', async () => {
    const user = userEvent.setup();
    // A catalogue type with no DB row: synthetic id, no timestamps.
    mockGet.mockResolvedValue({
      data: {
        data: [
          template({ id: 'default:verification_otp:en', created_at: null, updated_at: null }),
        ],
      },
    });
    let resolvePut = () => {};
    mockPut.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePut = () => resolve({ data: { data: {} } });
        }),
    );
    renderPage();

    expect(await screen.findByText('Last updated —')).toBeInTheDocument();
    await user.type(await screen.findByDisplayValue('Your code'), ' v1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // The save persists the row, so the refetch brings back a real UUID.
    mockGet.mockResolvedValue({
      data: {
        data: [
          template({
            id: '8f1c2a10-0f1e-4a3b-9c7d-2b6e5f4a1d90',
            subject: 'Your code v1',
            created_at: '2026-08-02T10:00:00.000Z',
            updated_at: '2026-08-02T10:00:00.000Z',
          }),
        ],
      },
    });
    // Typed after Save was clicked, before the invalidate/refetch lands.
    await user.type(screen.getByDisplayValue('Your code v1'), ' v2');
    await act(async () => {
      resolvePut();
    });

    expect(await screen.findByText(/Last updated 02\/08\/2026/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Your code v1 v2')).toBeInTheDocument();
    // Still unsaved, and still says so.
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

// A stored row whose type has left the backend catalogue: the PUT and test-send
// enums derive from that catalogue, so both routes 400 on it.
describe('EmailTemplatesPage read-only rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables save and test-send on a row the backend will not accept', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({
      data: {
        data: [template(), template({ id: 't_9', type: 'invoice_overdue', is_editable: false })],
      },
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Invoice Overdue' }));

    expect(await screen.findByText(/no longer used by the app/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send test to me' })).toBeDisabled();

    // Dirtying the form does not unlock Save.
    await user.type(screen.getByDisplayValue('Your code'), '!');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('leaves an editable row alone', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({ data: { data: [template()] } });
    renderPage();

    await user.type(await screen.findByDisplayValue('Your code'), '!');

    expect(screen.queryByText(/no longer used by the app/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Send test to me' })).toBeEnabled();
  });
});
