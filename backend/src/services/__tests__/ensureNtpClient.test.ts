import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureNtpClient } from '../routerOs.service';

/**
 * Builds a routeros-client-shaped mock for `/system/ntp/client`.
 *
 * The `get()` result mirrors the real transform: `.id` is stripped, keys are
 * camelCased, and yes/no/true/false are returned as booleans. For a singleton
 * menu, routeros-client returns an array of one record.
 *
 * `exec('set', payload)` is the write path we assert on; `/system/ntp/client`
 * has no `.id` so we can't use `.update()` without a prior query.
 */
function buildMockApi(current: Record<string, unknown> | null) {
  const exec = vi.fn().mockResolvedValue(undefined);
  const get = vi.fn().mockResolvedValue(current === null ? [] : [current]);
  const api = {
    menu: vi.fn((path: string) => {
      if (path === '/system/ntp/client') return { get, exec };
      return { get: vi.fn().mockResolvedValue([]), exec: vi.fn() };
    }),
  };
  return { api, exec, get };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureNtpClient', () => {
  it('already enabled with servers → already_configured, no write', async () => {
    const { api, exec } = buildMockApi({ enabled: true, servers: 'time.cloudflare.com' });

    const result = await ensureNtpClient(api);

    expect(result.status).toBe('already_configured');
    expect(exec).not.toHaveBeenCalled();
  });

  it('disabled → repaired, sets enabled=yes and servers', async () => {
    const { api, exec } = buildMockApi({ enabled: false, servers: '' });

    const result = await ensureNtpClient(api);

    expect(result.status).toBe('repaired');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('set', {
      enabled: 'yes',
      servers: 'time.cloudflare.com,pool.ntp.org,time.google.com',
    });
  });

  it('enabled but empty servers → repaired, writes servers', async () => {
    const { api, exec } = buildMockApi({ enabled: true, servers: '' });

    const result = await ensureNtpClient(api);

    expect(result.status).toBe('repaired');
    expect(exec).toHaveBeenCalledWith('set', {
      enabled: 'yes',
      servers: 'time.cloudflare.com,pool.ntp.org,time.google.com',
    });
  });

  it('disabled with existing servers → repaired, only enabled flipped (servers preserved)', async () => {
    const { api, exec } = buildMockApi({ enabled: false, servers: 'pool.ntp.org' });

    const result = await ensureNtpClient(api);

    expect(result.status).toBe('repaired');
    // servers already non-empty, so payload only enables the client — operator
    // customization (their chosen pool) is preserved.
    expect(exec).toHaveBeenCalledWith('set', { enabled: 'yes' });
  });

  it('read error → failed, does not throw, no write attempted', async () => {
    const exec = vi.fn();
    const api = {
      menu: vi.fn(() => ({
        get: vi.fn().mockRejectedValue(new Error('socket timeout')),
        exec,
      })),
    };

    const result = await ensureNtpClient(api);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('socket timeout');
    expect(exec).not.toHaveBeenCalled();
  });
});
