import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the axios wrapper: one route serves the log, the other the type catalogue.
vi.mock('../../lib/api', () => ({
  default: { get: vi.fn() },
}));

import api from '../../lib/api';
import { EMAIL_TEMPLATES_KEY } from '../../lib/emailTemplates';
import EmailLogPage from '../EmailLogPage';

const mockGet = api.get as unknown as Mock;

const log = {
  id: 'l_1',
  user_id: 'u_1',
  recipient: 'operator@example.com',
  type: 'support_reply_user',
  language: 'en',
  subject: 'Re: your ticket',
  status: 'sent',
  error: null,
  created_at: '2026-08-01T10:00:00.000Z',
};

const templateRows = [
  { id: 't_1', type: 'verification_otp', language: 'en' },
  { id: 't_2', type: 'payment_approved', language: 'en' },
  { id: 't_3', type: 'support_message_admin', language: 'en' },
  { id: 't_4', type: 'support_reply_user', language: 'ar' },
];

function mockRoutes(templates: unknown[] = templateRows) {
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/admin/email-templates') return { data: { data: templates } };
    return { data: { data: [log], meta: { total: 1 } } };
  });
}

function renderPage(queryClient = newClient()) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <EmailLogPage />
      </QueryClientProvider>,
    ),
  };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

// The type filter is the page's only <select>.
function optionLabels(): string[] {
  const select = screen.getByRole('combobox');
  return Array.from(select.querySelectorAll('option')).map((o) => o.textContent ?? '');
}

describe('EmailLogPage type filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoutes();
  });

  it('derives the options from the template catalogue with "All Types" pinned first', async () => {
    renderPage();

    expect(await screen.findByRole('option', { name: 'Support Reply (User)' })).toBeInTheDocument();
    expect(optionLabels()).toEqual([
      'All Types',
      'Verification OTP',
      'Payment Approved',
      'Support Message (Admin)',
      'Support Reply (User)',
    ]);
  });

  it('renders an unrecognised backend type with a humanized label', async () => {
    mockRoutes([...templateRows, { id: 't_9', type: 'invoice_overdue', language: 'en' }]);
    renderPage();

    expect(await screen.findByRole('option', { name: 'Invoice Overdue' })).toBeInTheDocument();
  });

  it('reads the catalogue the templates page cached under the shared key', () => {
    const queryClient = newClient();
    queryClient.setQueryData(EMAIL_TEMPLATES_KEY, templateRows);

    renderPage(queryClient);

    // Present on the very first render — no await — so the options came from
    // the shared cache entry rather than from this page's own round trip.
    expect(screen.getByRole('option', { name: 'Support Message (Admin)' })).toBeInTheDocument();
  });

  it('still renders the log when the catalogue request fails', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/admin/email-templates') throw new Error('boom');
      return { data: { data: [log], meta: { total: 1 } } };
    });
    renderPage();

    expect(await screen.findByText('operator@example.com')).toBeInTheDocument();
    expect(optionLabels()).toEqual(['All Types']);
  });
});
