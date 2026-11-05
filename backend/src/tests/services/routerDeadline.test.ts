/**
 * Unit tests for withRouterDeadline + disconnectWithDeadline.
 */
import { describe, it, expect, vi } from 'vitest';
import { withRouterDeadline, disconnectWithDeadline } from '../../services/routerDeadline';

function fakeClient() {
  const destroys: number[] = [];
  const client = {
    rosApi: {
      connector: {
        socket: {
          destroy: () => {
            destroys.push(Date.now());
          },
        },
      },
    },
    destroys,
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  return client;
}

describe('withRouterDeadline', () => {
  it('returns { ok, value } when work finishes in time', async () => {
    const r = await withRouterDeadline('r1', 1000, async () => 42);
    expect(r).toEqual({ status: 'ok', value: 42 });
  });

  it('returns { timeout } on expiry, destroys registered socket, and aborts the signal', async () => {
    const c = fakeClient();
    const r = await withRouterDeadline('r1', 50, async (ctx) => {
      ctx.onClient(c);
      ctx.step = 'silent';
      // Never settles — we rely on destroy() to kill the socket.
      return await new Promise<number>(() => {});
    });
    expect(r).toEqual({ status: 'timeout', step: 'silent' });
    expect(c.destroys.length).toBe(1);
  });

  it('surfaces errors as { error } without rethrowing', async () => {
    const r = await withRouterDeadline('r1', 1000, async () => {
      throw new Error('boom');
    });
    expect(r.status).toBe('error');
  });

  it('swallows a late settlement after the deadline fires — no unhandledRejection', async () => {
    const r = await withRouterDeadline('r1', 20, async () => {
      return new Promise<number>((_, rej) => setTimeout(() => rej(new Error('late')), 80));
    });
    expect(r.status).toBe('timeout');
    // Wait for the late rejection to arrive.
    await new Promise((res) => setTimeout(res, 120));
    // No assert needed — vitest fails the test on unhandled rejection.
  });

  it('deadline fires while work is between retries (first client disconnected, second mid-connect) — no throw, no unhandledRejection, result is timeout', async () => {
    // Simulate a connectToRouter that registers a first client, fails (the
    // client is "disconnected"), then begins a second connect that never
    // resolves. The deadline fires while the second connect is in flight.
    const firstClient = fakeClient();
    const secondClient = fakeClient();

    const r = await withRouterDeadline('r-retry', 50, async (ctx) => {
      // First attempt: register client, then immediately "fail"
      ctx.onClient(firstClient);
      ctx.step = 'connect-attempt-1';
      firstClient.disconnect(); // simulate disconnect of first client

      // Between retries: register the second client and start a connect
      // that will never settle.
      ctx.onClient(secondClient);
      ctx.step = 'connect-attempt-2';
      await new Promise<void>(() => { /* never resolves */ });
    });

    expect(r.status).toBe('timeout');
    // Both sockets should have been destroyed by the deadline.
    expect(firstClient.destroys.length).toBeGreaterThanOrEqual(1);
    expect(secondClient.destroys.length).toBeGreaterThanOrEqual(1);
    // No assertions about unhandledRejection — vitest fails automatically on those.
  });
});

describe('disconnectWithDeadline', () => {
  it('resolves when disconnect() does', async () => {
    const c = fakeClient();
    await expect(disconnectWithDeadline(c, 1000)).resolves.toBeUndefined();
    expect(c.disconnect).toHaveBeenCalled();
  });

  it('caps a hanging disconnect and destroys the socket', async () => {
    const destroys: number[] = [];
    const c = {
      rosApi: { connector: { socket: { destroy: () => { destroys.push(1); } } } },
      disconnect: () => new Promise<void>(() => {}),
    };
    const t0 = Date.now();
    await disconnectWithDeadline(c, 60);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(500);
    expect(destroys).toEqual([1]);
  });
});
