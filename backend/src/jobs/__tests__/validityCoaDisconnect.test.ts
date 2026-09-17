import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so the mocks exist before vi.mock factories evaluate.
const { cronTicks, sendDisconnectRequestMock } = vi.hoisted(() => ({
  cronTicks: [] as Array<() => void | Promise<void>>,
  sendDisconnectRequestMock: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: (_expr: string, fn: () => void | Promise<void>) => {
      cronTicks.push(fn);
      return { start: vi.fn(), stop: vi.fn() };
    },
  },
}));

vi.mock('../../services/radclient.service', () => ({
  sendDisconnectRequest: sendDisconnectRequestMock,
}));

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

import { startValidityCoaDisconnectJob, _resetJobState } from '../validityCoaDisconnect';

beforeEach(() => {
  cronTicks.length = 0;
  mockQuery.mockReset();
  sendDisconnectRequestMock.mockReset();
  sendDisconnectRequestMock.mockResolvedValue('ack');
  _resetJobState();
});

describe('validityCoaDisconnect job', () => {
  it('issues a Disconnect-Request for each expired-with-active-session row', async () => {
    startValidityCoaDisconnectJob();

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          username: 'voucher-a',
          nasipaddress: '10.10.0.2',
          acctsessionid: 'session-a',
          framedipaddress: '192.168.88.50',
          secret: 'shared-a',
        },
        {
          username: 'voucher-b',
          nasipaddress: '10.10.0.6',
          acctsessionid: 'session-b',
          framedipaddress: null,
          secret: 'shared-b',
        },
      ],
    });

    await cronTicks[0]();

    expect(sendDisconnectRequestMock).toHaveBeenCalledTimes(2);
    expect(sendDisconnectRequestMock).toHaveBeenNthCalledWith(1, {
      secret: 'shared-a',
      nasIp: '10.10.0.2',
      username: 'voucher-a',
      acctSessionId: 'session-a',
      framedIp: '192.168.88.50',
    });
    expect(sendDisconnectRequestMock).toHaveBeenNthCalledWith(2, {
      secret: 'shared-b',
      nasIp: '10.10.0.6',
      username: 'voucher-b',
      acctSessionId: 'session-b',
      framedIp: undefined,
    });
  });

  it('is a no-op when no rows match', async () => {
    startValidityCoaDisconnectJob();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await cronTicks[0]();

    expect(sendDisconnectRequestMock).not.toHaveBeenCalled();
  });

  it('does not throw when the query fails', async () => {
    startValidityCoaDisconnectJob();
    mockQuery.mockRejectedValueOnce(new Error('db down'));

    await expect(cronTicks[0]()).resolves.toBeUndefined();
    expect(sendDisconnectRequestMock).not.toHaveBeenCalled();
  });

  it('LIMIT 200 is present in the query', async () => {
    startValidityCoaDisconnectJob();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await cronTicks[0]();

    const sql = (mockQuery.mock.calls[0] as [string])[0];
    expect(sql).toMatch(/LIMIT\s+200/i);
  });

  it('guard prevents overlapping ticks', async () => {
    startValidityCoaDisconnectJob();

    let releaseFirst!: () => void;
    const blocked = new Promise<void>((res) => {
      releaseFirst = res;
    });

    // First tick: query hangs until we release it
    mockQuery.mockReturnValueOnce(blocked.then(() => ({ rows: [] })));

    const tick1 = cronTicks[0](); // running = true, then awaits query
    const tick2 = cronTicks[0](); // guard fires: running is true → returns immediately
    await tick2;

    // Only tick1 hit the pool; tick2 was a no-op
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(sendDisconnectRequestMock).not.toHaveBeenCalled();

    // Let tick1 finish
    releaseFirst();
    await tick1;
  });
});
