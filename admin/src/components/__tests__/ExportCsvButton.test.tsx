import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn() },
}));

import api from '../../lib/api';
import { ToastProvider } from '../../hooks/useToast';
import ExportCsvButton from '../ExportCsvButton';

const mockGet = api.get as unknown as Mock;

function renderButton(params: Record<string, string | undefined>) {
  return render(
    <ToastProvider>
      <ExportCsvButton path="/admin/users/export" params={params} />
    </ToastProvider>,
  );
}

describe('ExportCsvButton', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let capturedDownload = '';

  beforeEach(() => {
    vi.clearAllMocks();
    capturedDownload = '';
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        capturedDownload = this.download;
      });
  });

  it('fires a blob GET with the given params, omitting empty values, and downloads the filename from content-disposition', async () => {
    mockGet.mockResolvedValue({
      data: new Blob(['id,name']),
      headers: { 'content-disposition': 'attachment; filename="wasel-users-2026-07-16.csv"' },
    });
    const user = userEvent.setup();
    renderButton({ search: 'acme', status: '' });

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    expect(mockGet).toHaveBeenCalledWith('/admin/users/export', {
      params: { search: 'acme' },
      responseType: 'blob',
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(capturedDownload).toBe('wasel-users-2026-07-16.csv');
  });

  it('falls back to a generic filename when content-disposition is missing', async () => {
    mockGet.mockResolvedValue({ data: new Blob(['id,name']), headers: {} });
    const user = userEvent.setup();
    renderButton({ status: undefined });

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(mockGet).toHaveBeenCalledWith('/admin/users/export', {
      params: {},
      responseType: 'blob',
    });
    expect(capturedDownload).toBe('wasel-export.csv');
  });

  it('shows an error toast when the export request rejects', async () => {
    mockGet.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    renderButton({ status: 'active' });

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByText('Export failed')).toBeInTheDocument();
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
