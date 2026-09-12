/**
 * Tests for connectToRouter() error-listener safety guarantee.
 *
 * Verifies that:
 *   (a) a 'error' listener is attached to the client after a successful connect
 *   (b) emitting 'error' on the connected client does not throw
 *   (c) each abandoned client (after a rejected connect()) has disconnect() called
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

// ---- Hoisted registry + FakeClient class ------------------------------------
// Everything inside vi.hoisted() runs before vi.mock() factories, so we can
// build the class here and reference it from the factory.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rosState: any = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events') as typeof import('events');

  const state = {
    instanceCount: 0,
    disconnectCalls: 0,
    connectShouldReject: false,
  };

  class FakeClientCtor extends EventEmitter {
    constructor(_opts: unknown) {
      super();
      state.instanceCount++;
    }

    connect(): Promise<unknown> {
      if (state.connectShouldReject) {
        return Promise.reject(new Error('connection refused'));
      }
      return Promise.resolve({ menu: () => ({}) });
    }

    disconnect(): Promise<void> {
      state.disconnectCalls++;
      return Promise.resolve();
    }
  }

  return { FakeClientCtor, state };
});

vi.mock('routeros-client', () => ({
  RouterOSClient: rosState.FakeClientCtor,
}));

vi.mock('../../utils/encryption', () => ({
  decrypt: vi.fn((_v: string) => 'decrypted-password'),
}));

// Import after mocks are wired.
import { connectToRouter } from '../../services/routerOs.service';

// ---- Helpers -----------------------------------------------------------------

const ROUTER_ID = 'aaaaaaaa-1111-4000-8000-aaaaaaaaaaaa';
const USER_ID   = 'bbbbbbbb-1111-4000-8000-bbbbbbbbbbbb';
const rosClientState = rosState.state;

function primeRouterRow(overrides: Record<string, unknown> = {}) {
  mockQuery.mockResolvedValueOnce({
    rows: [{
      id: ROUTER_ID,
      tunnel_ip: '10.10.1.2',
      api_user: 'admin',
      api_pass_enc: 'enc:pass',
      ...overrides,
    }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rosClientState.instanceCount = 0;
  rosClientState.disconnectCalls = 0;
  rosClientState.connectShouldReject = false;
});

// ---- Tests -------------------------------------------------------------------

describe('connectToRouter() error-listener guard', () => {
  it('(a) attaches an error listener to the client after a successful connect', async () => {
    primeRouterRow();

    const { client } = await connectToRouter(ROUTER_ID, USER_ID);

    expect((client as unknown as { listenerCount(e: string): number }).listenerCount('error')).toBeGreaterThan(0);
  });

  it('(b) emitting error on the connected client does not throw', async () => {
    primeRouterRow();

    const { client } = await connectToRouter(ROUTER_ID, USER_ID);

    expect(() => {
      (client as unknown as { emit(e: string, err: Error): void }).emit('error', new Error('Timed out after 30 seconds'));
    }).not.toThrow();
  });

  it('(c) calls disconnect() on each abandoned client after failed connect attempts', async () => {
    primeRouterRow();
    rosClientState.connectShouldReject = true;

    await expect(connectToRouter(ROUTER_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 502,
    });

    // 3 attempts (initial + 2 retries)
    expect(rosClientState.instanceCount).toBe(3);
    // each must have called disconnect()
    expect(rosClientState.disconnectCalls).toBe(3);
  });
});
