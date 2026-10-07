import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureMacCookieRelogin } from '../routerOs.service';

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
        return { get: vi.fn().mockResolvedValue(hsProfiles), where: hsWhere };
      }
      if (path === '/ip/hotspot/user/profile') {
        return { get: vi.fn().mockResolvedValue(userProfiles), where: userWhere };
      }
      return { get: vi.fn().mockResolvedValue([]) };
    }),
  };

  return { api, hsUpdate, userUpdate, hsWhere, userWhere };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureMacCookieRelogin', () => {
  it('no drift: zero update calls and repaired []', async () => {
    const { api, hsUpdate, userUpdate } = buildMockApi(
      [{ id: '*1', name: 'hsprof1', loginBy: 'http-chap,mac-cookie' }],
      [{ id: '*2', name: 'default', addMacCookie: true, macCookieTimeout: '4w2d' }],
    );

    const result = await ensureMacCookieRelogin(api, { serverProfileNames: ['hsprof1'] });

    expect(result).toEqual({ checked: true, repaired: [] });
    expect(hsUpdate).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("appends ,mac-cookie to existing 'cookie,http-chap' preserving order", async () => {
    const { api, hsUpdate, hsWhere } = buildMockApi(
      [{ id: '*1', name: 'hsprof1', loginBy: 'cookie,http-chap' }],
      [{ id: '*2', name: 'default', addMacCookie: true, macCookieTimeout: '30d' }],
    );

    const result = await ensureMacCookieRelogin(api, { serverProfileNames: ['hsprof1'] });

    expect(result.checked).toBe(true);
    expect(result.repaired).toContain('login-by:hsprof1');
    expect(hsWhere).toHaveBeenCalledWith('.id', '*1');
    expect(hsUpdate).toHaveBeenCalledWith({ 'login-by': 'cookie,http-chap,mac-cookie' });
  });

  it('with serverProfileNames=[hsprof1], updates only hsprof1 not default', async () => {
    const { api, hsUpdate, hsWhere } = buildMockApi(
      [
        { id: '*1', name: 'default', loginBy: 'cookie,http-chap' },
        { id: '*2', name: 'hsprof1', loginBy: 'cookie,http-chap' },
      ],
      [{ id: '*3', name: 'default', addMacCookie: true, macCookieTimeout: '30d' }],
    );

    const result = await ensureMacCookieRelogin(api, { serverProfileNames: ['hsprof1'] });

    expect(result.checked).toBe(true);
    expect(hsUpdate).toHaveBeenCalledTimes(1);
    expect(hsWhere).toHaveBeenCalledWith('.id', '*2');
    expect(hsWhere).not.toHaveBeenCalledWith('.id', '*1');
  });

  it('empty serverProfileNames falls back to default profile', async () => {
    const { api, hsUpdate, hsWhere } = buildMockApi(
      [
        { id: '*1', name: 'hsprof1', loginBy: 'cookie,http-chap' },
        { id: '*2', name: 'default', loginBy: 'cookie,http-chap' },
      ],
      [{ id: '*3', name: 'default', addMacCookie: true, macCookieTimeout: '30d' }],
    );

    const result = await ensureMacCookieRelogin(api, { serverProfileNames: [] });

    expect(result.checked).toBe(true);
    expect(hsUpdate).toHaveBeenCalledTimes(1);
    expect(hsWhere).toHaveBeenCalledWith('.id', '*2');
  });

  it('addMacCookie=false with non-zero timeout: sets add-mac-cookie only', async () => {
    const { api, userUpdate, userWhere } = buildMockApi(
      [{ id: '*1', name: 'hsprof1', loginBy: 'http-chap,mac-cookie' }],
      [{ id: '*2', name: 'default', addMacCookie: false, macCookieTimeout: '3d' }],
    );

    const result = await ensureMacCookieRelogin(api, { serverProfileNames: ['hsprof1'] });

    expect(result.checked).toBe(true);
    expect(result.repaired).toContain('add-mac-cookie');
    expect(result.repaired).not.toContain('mac-cookie-timeout');
    expect(userWhere).toHaveBeenCalledWith('.id', '*2');
    expect(userUpdate).toHaveBeenCalledWith({ 'add-mac-cookie': 'yes' });
  });

  it("addMacCookie=false with timeout '0s': sets both, timeout '30d'", async () => {
    const { api, userUpdate } = buildMockApi(
      [{ id: '*1', name: 'hsprof1', loginBy: 'http-chap,mac-cookie' }],
      [{ id: '*2', name: 'default', addMacCookie: false, macCookieTimeout: '0s' }],
    );

    const result = await ensureMacCookieRelogin(api, { serverProfileNames: ['hsprof1'] });

    expect(result.checked).toBe(true);
    expect(result.repaired).toEqual(expect.arrayContaining(['add-mac-cookie', 'mac-cookie-timeout']));
    expect(userUpdate).toHaveBeenCalledWith({
      'add-mac-cookie': 'yes',
      'mac-cookie-timeout': '30d',
    });
  });

  it("addMacCookie=true with timeout '165w' is left untouched", async () => {
    const { api, userUpdate } = buildMockApi(
      [{ id: '*1', name: 'hsprof1', loginBy: 'http-chap,mac-cookie' }],
      [{ id: '*2', name: 'default', addMacCookie: true, macCookieTimeout: '165w' }],
    );

    const result = await ensureMacCookieRelogin(api, { serverProfileNames: ['hsprof1'] });

    expect(result).toEqual({ checked: true, repaired: [] });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('.get() rejects: returns { checked:false, error } without throwing', async () => {
    const api = {
      menu: vi.fn().mockReturnValue({
        get: vi.fn().mockRejectedValue(new Error('RouterOS connection lost')),
        where: vi.fn().mockReturnValue({ update: vi.fn() }),
      }),
    };

    const result = await ensureMacCookieRelogin(api, { serverProfileNames: ['hsprof1'] });
    expect(result.checked).toBe(false);
    expect(result.error).toBe('RouterOS connection lost');
    expect(result.repaired).toEqual([]);
  });
});
