import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock factories so they exist before vi.mock() runs.
// ---------------------------------------------------------------------------
const { mockExecFile, mockLoggerWarn, mockLoggerInfo, mockLoggerDebug } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerDebug: vi.fn(),
}));

// Mock child_process.execFile with the 4-argument callback signature the
// service uses: execFile(file, args, options, cb). We deliberately do NOT
// rely on util.promisify.custom — the service switched away from promisify
// after the 2026-09-15 hang so the tests must not either.
vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

vi.mock('../../config/logger', () => ({
  default: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: vi.fn(),
    debug: mockLoggerDebug,
  },
}));

// Import AFTER mocks so the service picks them up.
import {
  runRadmin,
  showFreeradiusClients,
  getFreeradiusStartTime,
  evictDynamicClient,
} from '../freeradius.service';

// ---------------------------------------------------------------------------
// Helpers — build the (err, stdout, stderr) tuples execFile's callback expects.
// ---------------------------------------------------------------------------
type ExecFileArgs = [
  string,
  string[],
  { timeout?: number; killSignal?: NodeJS.Signals | string; maxBuffer?: number },
  (
    err:
      | (Error & { killed?: boolean; signal?: NodeJS.Signals | null; code?: number | string })
      | null,
    stdout: string,
    stderr: string,
  ) => void,
];

function respondOk(stdout: string, stderr = ''): void {
  mockExecFile.mockImplementationOnce((...args: unknown[]) => {
    const cb = (args as unknown as ExecFileArgs)[3];
    // Deliver asynchronously to mirror real execFile behaviour: callers
    // await runRadmin(), so a synchronous callback would still work, but
    // real code has one turn of the event loop between spawn and reply.
    setImmediate(() => cb(null, stdout, stderr));
    return {} as unknown;
  });
}

function respondWithError(opts: {
  message?: string;
  stdout?: string;
  stderr?: string;
  killed?: boolean;
  signal?: NodeJS.Signals;
  code?: number | string;
}): void {
  mockExecFile.mockImplementationOnce((...args: unknown[]) => {
    const cb = (args as unknown as ExecFileArgs)[3];
    const err = Object.assign(new Error(opts.message ?? 'radmin error'), {
      killed: opts.killed ?? false,
      signal: opts.signal ?? null,
      code: opts.code,
    });
    setImmediate(() => cb(err, opts.stdout ?? '', opts.stderr ?? ''));
    return {} as unknown;
  });
}

function respondThrows(message: string): void {
  // Simulate a synchronous spawn failure (e.g. binary missing entirely).
  mockExecFile.mockImplementationOnce(() => {
    throw new Error(message);
  });
}

const RADMIN_SOCKET = '/var/run/freeradius/radmin.sock';

beforeEach(() => {
  mockExecFile.mockReset();
  mockLoggerWarn.mockReset();
  mockLoggerInfo.mockReset();
  mockLoggerDebug.mockReset();
});

// ---------------------------------------------------------------------------
// runRadmin
// ---------------------------------------------------------------------------
describe('runRadmin', () => {
  it('resolves ok on successful execution with timeout + killSignal set', async () => {
    respondOk('show clients output\n');

    const result = await runRadmin('show clients');

    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('show clients output\n');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);

    const call = mockExecFile.mock.calls[0] as unknown as ExecFileArgs;
    expect(call[0]).toBe('radmin');
    expect(call[1]).toEqual(['-f', RADMIN_SOCKET, '-e', 'show clients']);
    expect(call[2].timeout).toBe(3_000);
    expect(call[2].killSignal).toBe('SIGKILL');
    expect(call[2].maxBuffer).toBe(1024 * 1024);
  });

  it('honours a custom timeoutMs', async () => {
    respondOk('');
    await runRadmin('show uptime', 500);
    const call = mockExecFile.mock.calls[0] as unknown as ExecFileArgs;
    expect(call[2].timeout).toBe(500);
  });

  it('marks timedOut when the child was killed by our timeout', async () => {
    respondWithError({ message: 'killed', killed: true, signal: 'SIGKILL' });
    const result = await runRadmin('show clients');
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('does not throw on synchronous spawn failure', async () => {
    respondThrows('ENOENT');
    const result = await runRadmin('show clients');
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.error).toContain('ENOENT');
  });
});

// ---------------------------------------------------------------------------
// showFreeradiusClients
// ---------------------------------------------------------------------------
describe('showFreeradiusClients', () => {
  it('returns stdout on success', async () => {
    respondOk('Client 10.10.0.2\n');
    expect(await showFreeradiusClients()).toBe('Client 10.10.0.2\n');
  });

  it('returns an empty string and warns on failure', async () => {
    respondWithError({ message: 'boom' });
    expect(await showFreeradiusClients()).toBe('');
    expect(mockLoggerWarn).toHaveBeenCalled();
  });

  it('returns an empty string and warns on timeout', async () => {
    respondWithError({ message: 'killed', killed: true, signal: 'SIGKILL' });
    expect(await showFreeradiusClients()).toBe('');
    const args = mockLoggerWarn.mock.calls[0][1] as { timedOut?: boolean };
    expect(args.timedOut).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getFreeradiusStartTime
// ---------------------------------------------------------------------------
describe('getFreeradiusStartTime', () => {
  it('parses "Up since <date>"', async () => {
    respondOk('Up since Tue Sep 15 06:19:37 2026\n');
    expect(await getFreeradiusStartTime()).toBe('Tue Sep 15 06:19:37 2026');
  });

  it('trims trailing whitespace from the captured date', async () => {
    respondOk('Up since Tue Sep 15 06:19:37 2026   \n');
    expect(await getFreeradiusStartTime()).toBe('Tue Sep 15 06:19:37 2026');
  });

  it('returns null when the format does not match', async () => {
    respondOk('something unexpected\n');
    expect(await getFreeradiusStartTime()).toBeNull();
  });

  it('returns null on radmin failure', async () => {
    respondWithError({ message: 'gone' });
    expect(await getFreeradiusStartTime()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// evictDynamicClient
// ---------------------------------------------------------------------------
describe('evictDynamicClient', () => {
  // ---- invalid IPs: must never call execFile ------------------------------
  it.each<[string, string]>([
    ['smuggled listen tokens', '10.10.0.2 listen 1.2.3.4 1812'],
    ['non-tunnel range', '192.168.1.1'],
    ['empty string', ''],
    ['out-of-range octet', '10.10.0.256'],
    ['ipv6', 'fe80::1'],
    ['cidr suffix', '10.10.0.2/32'],
    ['leading whitespace', ' 10.10.0.2'],
  ])('rejects invalid IP (%s) without spawning radmin', async (_label, ip) => {
    const result = await evictDynamicClient(ip);
    expect(result).toBe('invalid_ip');
    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'evictDynamicClient rejected invalid IP',
      expect.objectContaining({ ip, outcome: 'invalid_ip' }),
    );
  });

  it('passes the correct argv and options to radmin for a valid IP', async () => {
    respondOk('');
    await evictDynamicClient('10.10.0.2');
    const call = mockExecFile.mock.calls[0] as unknown as ExecFileArgs;
    expect(call[0]).toBe('radmin');
    expect(call[1]).toEqual(['-f', RADMIN_SOCKET, '-e', 'del client ipaddr 10.10.0.2']);
    expect(call[2].timeout).toBe(3_000);
    expect(call[2].killSignal).toBe('SIGKILL');
  });

  it('returns "evicted" when radmin succeeds silently', async () => {
    respondOk(''); // upstream command_del_client prints nothing on success
    expect(await evictDynamicClient('10.10.0.2')).toBe('evicted');
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'evictDynamicClient: evicted',
      expect.objectContaining({ ip: '10.10.0.2', outcome: 'evicted' }),
    );
  });

  // Upstream 3.2.x `get_client()` is a longest-prefix lookup. For a 10.10.x.y
  // address with no cached /32 it finds the static `lookup_wasel_nas`
  // 10.10.0.0/16 network client from clients.conf, so the reply for an
  // uncached tunnel IP is "was not dynamically defined", not "No such client".
  // radmin prints server errors to stderr as "ERROR: <text>".
  it('returns "not_cached" at debug level for an uncached tunnel IP (enclosing /16 is static)', async () => {
    respondWithError({
      message: 'radmin failed',
      stderr: 'ERROR: Client 10.10.0.99 was not dynamically defined.\n',
      code: 1,
    });
    expect(await evictDynamicClient('10.10.0.99')).toBe('not_cached');
    expect(mockLoggerDebug).toHaveBeenCalledWith(
      'evictDynamicClient: not cached',
      expect.objectContaining({ ip: '10.10.0.99', outcome: 'not_cached' }),
    );
    // A normal create on a fresh IP must not produce a WARN line.
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('returns "not_cached" on "No such client" (no enclosing network client)', async () => {
    // Upstream text is exactly "No such client\n", with no IP.
    respondWithError({
      message: 'radmin failed',
      stderr: 'ERROR: No such client\n',
      code: 1,
    });
    expect(await evictDynamicClient('10.10.0.99')).toBe('not_cached');
    expect(mockLoggerDebug).toHaveBeenCalled();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('returns "timeout" when radmin was killed by our deadline', async () => {
    respondWithError({ message: 'killed', killed: true, signal: 'SIGKILL' });
    expect(await evictDynamicClient('10.10.0.2')).toBe('timeout');
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'evictDynamicClient: radmin timed out',
      expect.objectContaining({ ip: '10.10.0.2', outcome: 'timeout' }),
    );
  });

  it('returns "unavailable" when the control socket is missing or refused', async () => {
    respondWithError({
      message: "spawn radmin ENOENT",
      code: 'ENOENT',
    });
    expect(await evictDynamicClient('10.10.0.2')).toBe('unavailable');
  });

  it('returns "unavailable" on Connection refused from the control socket', async () => {
    respondWithError({
      message: 'radmin failed',
      stderr: 'radmin: Failed connecting to socket: Connection refused\n',
      code: 1,
    });
    expect(await evictDynamicClient('10.10.0.2')).toBe('unavailable');
  });

  it('returns "error" for any other radmin failure', async () => {
    respondWithError({
      message: 'radmin failed',
      stderr: 'ERROR: Some other unexpected failure\n',
      code: 1,
    });
    expect(await evictDynamicClient('10.10.0.2')).toBe('error');
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'evictDynamicClient: radmin failed',
      expect.objectContaining({ ip: '10.10.0.2', outcome: 'error' }),
    );
  });

  it('returns "unavailable" and does not throw on synchronous spawn exception', async () => {
    // ENOENT in runRadmin's captured error message trips the "unavailable"
    // classification via the combined+error regex.
    respondThrows('spawn radmin ENOENT');
    expect(await evictDynamicClient('10.10.0.2')).toBe('unavailable');
  });

  it('returns "error" and does not throw on an opaque synchronous spawn exception', async () => {
    respondThrows('completely opaque failure');
    expect(await evictDynamicClient('10.10.0.2')).toBe('error');
  });
});
