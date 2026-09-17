import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the axios wrapper. The System tab fans out to /admin/system-status and
// /admin/freeradius/status; the default (bank) tab hits /admin/settings/bank on
// mount. Route each URL explicitly so we can drive the FreeRADIUS card.
vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), put: vi.fn() },
}));

import api from '../../lib/api';
import SettingsPage from '../SettingsPage';

const mockGet = api.get as unknown as Mock;

const systemStatus = {
  database: { status: 'ok', responseMs: 3 },
  redis: { status: 'ok', responseMs: 1 },
  fcm: { status: 'disabled' },
  process: { uptimeSeconds: 3600, nodeVersion: 'v22.0.0', memoryMb: 128 },
};

const bankInfo = { bankName: '', accountNumber: '', accountHolder: '', instructions: '' };

const healthyFreeradius = {
  socket: { path: '/var/run/freeradius/radmin.sock', exists: true, readable: true, writable: true },
  clients: { raw: 'Client: cafe-router\nClient: office-router', lineCount: 2 },
  radius: { responding: true, outcome: 'accept', latencyMs: 12 },
};

// Incident 2026-09-15 shape: the control socket is still present and rw, but
// the server no longer answers Status-Server.
const hungFreeradius = {
  ...healthyFreeradius,
  radius: { responding: false, outcome: 'timeout', latencyMs: 2000 },
};

function routeGet(freeradius: () => Promise<unknown>) {
  mockGet.mockImplementation((url: string) => {
    if (url === '/admin/settings/bank') return Promise.resolve({ data: { data: bankInfo } });
    if (url === '/admin/system-status') return Promise.resolve({ data: { data: systemStatus } });
    if (url === '/admin/freeradius/status') return freeradius();
    return Promise.resolve({ data: { data: {} } });
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

describe('SettingsPage — FreeRADIUS card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a healthy FreeRADIUS card with client count and raw detail', async () => {
    routeGet(() => Promise.resolve({ data: { data: healthyFreeradius } }));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /System Status/ }));

    expect(await screen.findByText('FreeRADIUS')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    // The count is bold ("2") followed by " cached clients" — assert the plural label.
    expect(screen.getByText(/cached clients/)).toBeInTheDocument();
    expect(screen.getByText('RADIUS: responding (12 ms)')).toBeInTheDocument();
    expect(screen.getByText('Raw radmin output')).toBeInTheDocument();
  });

  it('bounds the status request with a client-side timeout', async () => {
    routeGet(() => Promise.resolve({ data: { data: healthyFreeradius } }));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /System Status/ }));
    await screen.findByText('FreeRADIUS');

    expect(mockGet).toHaveBeenCalledWith(
      '/admin/freeradius/status',
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('marks the card unhealthy when RADIUS does not answer even though the socket is fine', async () => {
    routeGet(() => Promise.resolve({ data: { data: hungFreeradius } }));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /System Status/ }));

    expect(await screen.findByText('FreeRADIUS')).toBeInTheDocument();
    expect(screen.getByText('Unhealthy')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.getByText(/RADIUS: not responding/)).toBeInTheDocument();
  });

  it('omits the RADIUS line for an older backend without the probe', async () => {
    const legacy = { socket: healthyFreeradius.socket, clients: healthyFreeradius.clients };
    routeGet(() => Promise.resolve({ data: { data: legacy } }));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /System Status/ }));

    expect(await screen.findByText('FreeRADIUS')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.queryByText(/RADIUS:/)).not.toBeInTheDocument();
  });

  it('shows the error panel when the FreeRADIUS status request fails', async () => {
    routeGet(() => Promise.reject(new Error('socket unreachable')));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /System Status/ }));

    // Core status grid still renders; only the FreeRADIUS card errors.
    expect(await screen.findByText('Failed to load data')).toBeInTheDocument();
    expect(screen.getByText('socket unreachable')).toBeInTheDocument();
  });
});
