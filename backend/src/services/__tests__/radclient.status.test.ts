import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockSpawn, mockLoggerWarn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('child_process', () => ({ spawn: mockSpawn }));
vi.mock('../../config/logger', () => ({
  default: {
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks so the spawn reference the service captures is our mock.
import { sendStatusServer } from '../radclient.service';

// ---------------------------------------------------------------------------
// Fake child process: EventEmitter + stdout/stderr sub-emitters + writeable
// stdin + a kill() spy. Mirrors the shape sendStatusServer touches.
// ---------------------------------------------------------------------------
interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
}

function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();
  return child;
}

beforeEach(() => {
  mockSpawn.mockReset();
  mockLoggerWarn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// argv + stdin shape
// ---------------------------------------------------------------------------
describe('sendStatusServer args and stdin', () => {
  it('spawns radclient with the correct argv and writes the MA seed on stdin', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValueOnce(child);

    const promise = sendStatusServer({ timeoutMs: 3_000 });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mockSpawn.mock.calls[0] as [string, string[], unknown];
    expect(cmd).toBe('radclient');
    // timeoutMs 3000 → -t 3, -r 1, loopback :1812, action "status", localhost secret.
    expect(args).toEqual(['-x', '-t', '3', '-r', '1', '127.0.0.1:1812', 'status', 'testing123']);
    expect(opts).toEqual({ stdio: ['pipe', 'pipe', 'pipe'] });

    // RFC 5997 Message-Authenticator seed value: radclient fills the real
    // digest in before signing.
    expect(child.stdin.write).toHaveBeenCalledWith('Message-Authenticator = 0x00\n');
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    // Complete the request so the promise resolves and the test doesn't leak
    // a pending timer.
    child.stdout.emit('data', Buffer.from('Received Access-Accept Id 0 from 127.0.0.1:1812'));
    child.emit('close', 0);
    await promise;
  });
});

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------
describe('sendStatusServer outcomes', () => {
  it('reports accept when radclient prints "Received Access-Accept"', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValueOnce(child);
    const promise = sendStatusServer();

    child.stdout.emit('data', Buffer.from('Received Access-Accept Id 0 from 127.0.0.1:1812'));
    child.emit('close', 0);

    const result = await promise;
    expect(result.responding).toBe(true);
    expect(result.outcome).toBe('accept');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports reject (still responding) on Access-Reject', async () => {
    // A reject proves FreeRADIUS' main thread is alive, so the monitor's
    // liveness check must treat it as "responding".
    const child = makeChild();
    mockSpawn.mockReturnValueOnce(child);
    const promise = sendStatusServer();

    child.stdout.emit('data', Buffer.from('Received Access-Reject Id 0 from 127.0.0.1:1812'));
    child.emit('close', 1);

    const result = await promise;
    expect(result.responding).toBe(true);
    expect(result.outcome).toBe('reject');
  });

  it('reports timeout via the kill timer when radclient never replies', async () => {
    vi.useFakeTimers();
    const child = makeChild();
    mockSpawn.mockReturnValueOnce(child);

    const promise = sendStatusServer({ timeoutMs: 3_000 });

    // No stdout, no close. Advance past the kill deadline (timeoutMs + 1s).
    await vi.advanceTimersByTimeAsync(3_000 + 1_100);

    const result = await promise;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(result.responding).toBe(false);
    expect(result.outcome).toBe('timeout');
  });

  it('reports timeout when spawn emits an error (e.g. radclient missing)', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValueOnce(child);
    const promise = sendStatusServer();

    child.emit('error', new Error('spawn radclient ENOENT'));

    const result = await promise;
    expect(result.responding).toBe(false);
    expect(result.outcome).toBe('timeout');
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'radclient status spawn failed',
      expect.objectContaining({ error: 'spawn radclient ENOENT' }),
    );
  });

  it('reports timeout when close arrives with no recognisable reply text', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValueOnce(child);
    const promise = sendStatusServer();

    child.stdout.emit('data', Buffer.from('garbage output that does not match'));
    child.emit('close', 0);

    const result = await promise;
    expect(result.responding).toBe(false);
    expect(result.outcome).toBe('timeout');
  });
});
