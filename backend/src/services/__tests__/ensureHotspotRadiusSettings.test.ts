import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureHotspotRadiusSettings } from '../routerOs.service';

// Build a mock api object that records calls to .menu().get() / .where().update()
function buildMockApi(
  hsProfiles: Record<string, unknown>[],
  userProfiles: Record<string, unknown>[],
) {
  const hsUpdate = vi.fn().mockResolvedValue(undefined);
  const userUpdate = vi.fn().mockResolvedValue(undefined);
  const hsWhere = vi.fn().mockReturnValue({ update: hsUpdate });
  const userWhere = vi.fn().mockReturnValue({ update: userUpdate });

  const api = {
    menu: vi.fn((path: string) => {
      if (path === '/ip/hotspot/profile') {
        return {
          get: vi.fn().mockResolvedValue(hsProfiles),
          where: hsWhere,
        };
      }
      if (path === '/ip/hotspot/user/profile') {
        return {
          get: vi.fn().mockResolvedValue(userProfiles),
          where: userWhere,
        };
      }
      return { get: vi.fn().mockResolvedValue([]) };
    }),
  };

  return { api, hsUpdate, userUpdate, hsWhere, userWhere };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureHotspotRadiusSettings', () => {
  it('updates hotspot profile with use-radius, radius-accounting, interim-update, login-by', async () => {
    const { api, hsUpdate } = buildMockApi(
      [{ '.id': '*1', name: 'default' }],
      [{ '.id': '*2', name: 'default' }],
    );

    await ensureHotspotRadiusSettings(api);

    expect(hsUpdate).toHaveBeenCalledTimes(1);
    expect(hsUpdate).toHaveBeenCalledWith({
      'use-radius': 'yes',
      'radius-accounting': 'yes',
      'radius-interim-update': '00:05:00',
      'login-by': 'mac-cookie,http-chap,http-pap,https',
    });
  });

  it('updates hotspot user profile with add-mac-cookie=yes and mac-cookie-timeout=30d', async () => {
    const { api, userUpdate } = buildMockApi(
      [{ '.id': '*1', name: 'default' }],
      [{ '.id': '*2', name: 'default' }],
    );

    await ensureHotspotRadiusSettings(api);

    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({
      'add-mac-cookie': 'yes',
      'mac-cookie-timeout': '30d',
    });
  });

  it('picks the "default" profile by name even when it is not first in the list', async () => {
    const { api, hsUpdate } = buildMockApi(
      [
        { '.id': '*1', name: 'hsprof1' },
        { '.id': '*2', name: 'default' },
      ],
      [{ '.id': '*3', name: 'default' }],
    );

    await ensureHotspotRadiusSettings(api);

    expect(hsUpdate).toHaveBeenCalledTimes(1);
    // The .where() call should use the *2 id (the default profile)
    const menuCallArgs = (api.menu as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const hsMenuCall = menuCallArgs.find((args) => args[0] === '/ip/hotspot/profile');
    expect(hsMenuCall).toBeDefined();
  });

  it('falls back to the first profile when none is named "default"', async () => {
    const { api, hsUpdate } = buildMockApi(
      [{ '.id': '*9', name: 'hsprof1' }],
      [{ '.id': '*10', name: 'hsuserprof1' }],
    );

    await ensureHotspotRadiusSettings(api);

    // Should still call update without throwing
    expect(hsUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the api call rejects (best-effort), returns false', async () => {
    const api = {
      menu: vi.fn().mockReturnValue({
        get: vi.fn().mockRejectedValue(new Error('RouterOS connection lost')),
        where: vi.fn().mockReturnValue({ update: vi.fn() }),
      }),
    };

    await expect(ensureHotspotRadiusSettings(api)).resolves.toBe(false);
  });

  it('does not throw when profile list is empty, returns true', async () => {
    const { api } = buildMockApi([], []);
    await expect(ensureHotspotRadiusSettings(api)).resolves.toBe(true);
  });

  it('with serverProfileNames, updates only the named profile (hsprof1), not default', async () => {
    const { api, hsUpdate, hsWhere } = buildMockApi(
      [
        { '.id': '*1', name: 'default' },
        { '.id': '*2', name: 'hsprof1' },
      ],
      [{ '.id': '*3', name: 'default' }],
    );

    const result = await ensureHotspotRadiusSettings(api, { serverProfileNames: ['hsprof1'] });

    expect(result).toBe(true);
    // Only hsprof1 (id *2) should have been updated — NOT the default profile (id *1).
    expect(hsUpdate).toHaveBeenCalledTimes(1);
    expect(hsWhere).toHaveBeenCalledWith('.id', '*2');
    expect(hsWhere).not.toHaveBeenCalledWith('.id', '*1');
  });
});
