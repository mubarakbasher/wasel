/**
 * Unit tests for parseRouterOsDurationMs, ensureRadiusTimeout,
 * isRadiusTimeoutRolloutEnabled, and the router-health /radius-timeout note.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: { RADIUS_TIMEOUT_ROLLOUT: '' } as any,
}));

import { config } from '../../config';
import { parseRouterOsDurationMs, ensureRadiusTimeout } from '../routerOs.service';
import { isRadiusTimeoutRolloutEnabled } from '../radiusTimeoutRollout';

describe('parseRouterOsDurationMs', () => {
  it('parses ms, s, m, h, d units and combinations', () => {
    expect(parseRouterOsDurationMs('300ms')).toBe(300);
    expect(parseRouterOsDurationMs('2s')).toBe(2000);
    expect(parseRouterOsDurationMs('1s500ms')).toBe(1500);
    expect(parseRouterOsDurationMs('1m')).toBe(60_000);
    expect(parseRouterOsDurationMs('1h2m3s')).toBe((3600 + 120 + 3) * 1000);
    expect(parseRouterOsDurationMs('1d')).toBe(86_400_000);
  });

  it('parses HH:MM:SS with optional fractional seconds', () => {
    expect(parseRouterOsDurationMs('00:00:02')).toBe(2000);
    expect(parseRouterOsDurationMs('01:30:00')).toBe(5_400_000);
    expect(parseRouterOsDurationMs('00:00:00.300')).toBe(300);
  });

  it('treats bare integer string as seconds (routeros-client coerces to number)', () => {
    expect(parseRouterOsDurationMs('2')).toBe(2000);
    expect(parseRouterOsDurationMs(2)).toBe(2000);
    expect(parseRouterOsDurationMs(0.3)).toBe(300);
  });

  it('returns null for unparseable / missing', () => {
    expect(parseRouterOsDurationMs('')).toBeNull();
    expect(parseRouterOsDurationMs(undefined)).toBeNull();
    expect(parseRouterOsDurationMs(null)).toBeNull();
    expect(parseRouterOsDurationMs('foo')).toBeNull();
    expect(parseRouterOsDurationMs('2sx')).toBeNull();
    expect(parseRouterOsDurationMs({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ensureRadiusTimeout
// ---------------------------------------------------------------------------

interface FakeRadiusRow {
  id: string;
  comment?: string;
  address?: string;
  service?: string;
  timeout?: string | number;
}

function fakeApi(rows: FakeRadiusRow[]) {
  const updates: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const api = {
    menu: (_path: string) => {
      let whereId: string | null = null;
      const chain = {
        get: async () => rows,
        where: (key: string, val: string) => {
          if (key === '.id') whereId = val;
          return chain;
        },
        update: async (payload: Record<string, unknown>) => {
          if (!whereId) throw new Error('update without .id');
          updates.push({ id: whereId, payload });
        },
      };
      return chain;
    },
  };
  return { api, updates };
}

describe('ensureRadiusTimeout', () => {
  it('raises rows with timeout < 2s', async () => {
    const { api, updates } = fakeApi([
      { id: '*1', comment: 'wasel', address: '10.10.0.1', service: 'hotspot,login', timeout: '300ms' },
      { id: '*2', comment: 'other', address: '1.2.3.4', service: 'ppp', timeout: '300ms' },
    ]);
    const r = await ensureRadiusTimeout(api);
    expect(r.status).toBe('raised');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ id: '*1', payload: { timeout: '2s' } });
  });

  it('matches by address+hotspot when comment missing', async () => {
    const { api, updates } = fakeApi([
      { id: '*3', address: '10.10.0.1', service: 'hotspot', timeout: 1 }, // 1s
    ]);
    const r = await ensureRadiusTimeout(api, { radiusServerIp: '10.10.0.1' });
    expect(r.status).toBe('raised');
    expect(updates).toHaveLength(1);
  });

  it('leaves higher values alone', async () => {
    const { api, updates } = fakeApi([
      { id: '*1', comment: 'wasel', timeout: '5s' },
    ]);
    const r = await ensureRadiusTimeout(api);
    expect(r.status).toBe('already');
    expect(updates).toHaveLength(0);
  });

  it('treats missing timeout as default 300ms and raises', async () => {
    const { api, updates } = fakeApi([{ id: '*1', comment: 'wasel' }]);
    const r = await ensureRadiusTimeout(api);
    expect(r.status).toBe('raised');
    expect(updates).toHaveLength(1);
  });

  it('returns "none" when no /radius entries', async () => {
    const { api } = fakeApi([]);
    expect((await ensureRadiusTimeout(api)).status).toBe('none');
  });

  it('returns "failed" on read error without throwing', async () => {
    const api = {
      menu: () => ({ get: () => Promise.reject(new Error('boom')) }),
    };
    const r = await ensureRadiusTimeout(api);
    expect(r.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// isRadiusTimeoutRolloutEnabled
// ---------------------------------------------------------------------------

describe('isRadiusTimeoutRolloutEnabled', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (config as any).RADIUS_TIMEOUT_ROLLOUT = '';
  });

  it('is off when unset / empty', () => {
    expect(isRadiusTimeoutRolloutEnabled('r1')).toBe(false);
  });

  it('is on for everyone when "all"', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (config as any).RADIUS_TIMEOUT_ROLLOUT = 'all';
    expect(isRadiusTimeoutRolloutEnabled('r1')).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (config as any).RADIUS_TIMEOUT_ROLLOUT = 'ALL';
    expect(isRadiusTimeoutRolloutEnabled('r1')).toBe(true);
  });

  it('is on only for listed IDs (trimmed)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (config as any).RADIUS_TIMEOUT_ROLLOUT = ' r1 , r2 ';
    expect(isRadiusTimeoutRolloutEnabled('r1')).toBe(true);
    expect(isRadiusTimeoutRolloutEnabled('r2')).toBe(true);
    expect(isRadiusTimeoutRolloutEnabled('r3')).toBe(false);
  });
});
