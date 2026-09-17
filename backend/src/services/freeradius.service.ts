import { execFile } from 'child_process';
import net from 'net';
import logger from '../config/logger';

/**
 * Thin wrapper around `radmin` for read-only probes against FR's running
 * state. NAS rows are loaded automatically by FR's dynamic_clients mechanism
 * on first packet — see freeradius/raddb/sites-enabled/dynamic-clients — so
 * no reload/restart is needed from this service.
 *
 * The control socket is exposed by FreeRADIUS via the control-socket virtual
 * server (freeradius/raddb/sites-enabled/control-socket). The backend
 * container mounts the parent directory from the freeradius container
 * through the `freeradius_control` named volume.
 */
const RADMIN_SOCKET = '/var/run/freeradius/radmin.sock';

export interface RadminResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  /** True when radmin was killed because it exceeded `timeoutMs`. */
  timedOut: boolean;
  error?: string;
}

/**
 * Invoke `radmin -f <sock> -e <command>` capturing stdout, stderr, and exit
 * code. A non-zero exit still produces a structured result instead of an
 * opaque exception so callers can surface the real failure reason (socket
 * missing, permission denied, unknown command, etc.).
 *
 * Incident 2026-09-15: an earlier version used `promisify(execFile)` with no
 * `timeout`, so a `radmin` call could hang forever when FreeRADIUS itself was
 * spinning in libtalloc — and the admin status card that awaited it did
 * exactly that. execFile's callback form with `{ timeout, killSignal: 'SIGKILL' }`
 * gives us a hard, kernel-enforced deadline that survives whatever state
 * radmin's socket peer is in.
 */
export function runRadmin(command: string, timeoutMs = 3_000): Promise<RadminResult> {
  const started = Date.now();
  return new Promise<RadminResult>((resolve) => {
    let settled = false;
    const finish = (r: RadminResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    try {
      execFile(
        'radmin',
        ['-f', RADMIN_SOCKET, '-e', command],
        // killSignal SIGKILL: SIGTERM can be swallowed by a wedged libc call;
        // SIGKILL is uncatchable and guarantees the timer bound is real.
        { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          const durationMs = Date.now() - started;
          // With the default encoding, execFile's callback delivers strings.
          const out = stdout ?? '';
          const errOut = stderr ?? '';
          if (!err) {
            finish({
              ok: true,
              stdout: out,
              stderr: errOut,
              exitCode: 0,
              durationMs,
              timedOut: false,
            });
            return;
          }
          // Node marks a timeout-induced kill with err.killed === true and
          // err.signal set to the configured killSignal.
          const e = err as NodeJS.ErrnoException & {
            killed?: boolean;
            signal?: NodeJS.Signals | null;
            code?: number | string;
          };
          const timedOut = e.killed === true || e.signal === 'SIGKILL';
          finish({
            ok: false,
            stdout: out,
            stderr: errOut,
            exitCode: typeof e.code === 'number' ? e.code : null,
            durationMs,
            timedOut,
            error: e.message,
          });
        },
      );
    } catch (err) {
      // Synchronous spawn failure (e.g. radmin missing entirely).
      finish({
        ok: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        durationMs: Date.now() - started,
        timedOut: false,
        error: (err as Error).message,
      });
    }
  });
}

/**
 * Invoke `radmin -e "show clients"` and return stdout. Exposed for use by
 * the admin status endpoint. Swallowed errors turn into an empty string so
 * callers can treat "radmin failed" as "not available". Bounded by
 * runRadmin's timeout — the admin card can no longer hang here (incident
 * 2026-09-15).
 */
export async function showFreeradiusClients(): Promise<string> {
  const result = await runRadmin('show clients');
  if (!result.ok) {
    logger.warn('radmin show clients failed', {
      socket: RADMIN_SOCKET,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stderr: result.stderr.trim(),
      error: result.error,
    });
    return '';
  }
  return result.stdout;
}

/**
 * Return the FreeRADIUS process start time as printed by `radmin -e "show
 * uptime"` (upstream format: `Up since <ctime>`). Used by the FreeRADIUS
 * monitor to detect an unexpected restart between probes. Returns null on
 * any failure so callers treat that as "unknown" instead of throwing.
 */
export async function getFreeradiusStartTime(): Promise<string | null> {
  const result = await runRadmin('show uptime');
  if (!result.ok) {
    logger.warn('radmin show uptime failed', {
      socket: RADMIN_SOCKET,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stderr: result.stderr.trim(),
      error: result.error,
    });
    return null;
  }
  const match = /^Up since (.+)$/m.exec(result.stdout);
  if (!match) return null;
  return match[1].trim();
}

/** Exposed for the admin status endpoint. */
export function getRadminSocketPath(): string {
  return RADMIN_SOCKET;
}

/**
 * Outcome of an attempted `del client ipaddr <ip>` on the FreeRADIUS
 * control socket.
 *
 *  - `evicted`        — the cached dynamic client was marked dead. The next
 *                       packet from that IP will trigger a fresh nas lookup.
 *  - `not_cached`     — no dynamic client is cached for this IP. Nothing to
 *                       do; the next packet still triggers a nas lookup.
 *                       This is the normal answer for a fresh tunnel IP or a
 *                       router that never sent RADIUS. radmin phrases it as
 *                       "Client <ip> was not dynamically defined." — see
 *                       evictDynamicClient for why.
 *  - `invalid_ip`     — refused before spawning: not IPv4 in 10.10.0.0/16.
 *                       Prevents smuggling extra tokens (e.g. "listen ...")
 *                       into radmin's command parser.
 *  - `timeout`        — runRadmin hit its deadline (SIGKILL'd radmin).
 *  - `unavailable`    — socket missing, connection refused, or ENOENT on
 *                       radmin itself. Backend cannot reach FR right now.
 *  - `error`          — any other radmin failure. Details logged; not thrown.
 */
export type EvictOutcome =
  | 'evicted'
  | 'not_cached'
  | 'invalid_ip'
  | 'timeout'
  | 'unavailable'
  | 'error';

/**
 * Drop the cached dynamic client for `ip` (a router's WireGuard tunnel IP)
 * so a subsequent packet re-runs the `dynamic_client_server` nas lookup
 * with the current shared secret.
 *
 * Incident 2026-09-15: dynamic clients used to expire on a 120 s timer, and
 * an upstream `listen.c` bug then freed them via a timer without reference
 * counting — a request stuck in SQL still pointed at freed memory and the
 * main thread spun in libtalloc for 5 h. Fix pairs `lifetime = 0` in
 * clients.conf (clients never auto-expire) with explicit eviction from the
 * backend on router create / router delete / admin user delete. Reusing a
 * tunnel IP for a different router therefore no longer needs a FreeRADIUS
 * restart.
 *
 * Eviction does NOT avoid the timed free. Upstream `command_del_client` only
 * sets `client->lifetime = 1`; the next packet from that IP makes
 * `client_listener_find()` delete the client and free it on the same
 * `max_request_time + 20` s timer with no reference counting. Callers must
 * therefore silence the IP first where they can (deleteRouter / deleteUser
 * remove the WireGuard peer before evicting), so no request from the evicted
 * router is still in flight when that free runs.
 *
 * Never throws. Caller should log the outcome but treat failure as
 * non-fatal to the surrounding request — the operator can always
 * `radmin -e "del client ipaddr <ip>"` or restart FreeRADIUS.
 */
export async function evictDynamicClient(ip: string): Promise<EvictOutcome> {
  const started = Date.now();
  try {
    // Strict validation BEFORE spawning: this string is concatenated into
    // the radmin command, so a token like "10.10.0.2 listen 1.2.3.4 1812"
    // would smuggle extra arguments into radmin's parser. `net.isIPv4`
    // rejects anything with whitespace, dots-of-4 mismatch, or CIDR.
    if (!net.isIPv4(ip) || !ip.startsWith('10.10.')) {
      logger.warn('evictDynamicClient rejected invalid IP', { ip, outcome: 'invalid_ip' });
      return 'invalid_ip';
    }

    const result = await runRadmin(`del client ipaddr ${ip}`);
    const combined = `${result.stdout}\n${result.stderr}`;
    const durationMs = Date.now() - started;

    // Order matters: check the successful-but-noisy string cases first,
    // then transport-level failures (timeout, unavailable), else generic error.
    //
    // Not cached. Upstream 3.2.x `get_client()` uses `client_find()`, a
    // longest-prefix match. With no cached /32 for a 10.10.x.y address it
    // lands on the static `lookup_wasel_nas` 10.10.0.0/16 network client from
    // clients.conf, which is not dynamic, so radmin prints "Client <ip> was
    // not dynamically defined." That is the normal answer for a fresh tunnel
    // IP. "No such client" only appears if that /16 stanza is removed. The IP
    // guard above limits input to 10.10.0.0/16, and clients.conf defines no
    // other static client in that range, so neither string means a static
    // client is shadowing a router.
    if (/No such client|not dynamically defined/i.test(combined)) {
      logger.debug('evictDynamicClient: not cached', { ip, outcome: 'not_cached', durationMs });
      return 'not_cached';
    }
    if (result.timedOut) {
      logger.warn('evictDynamicClient: radmin timed out', {
        ip,
        outcome: 'timeout',
        durationMs,
      });
      return 'timeout';
    }
    if (result.ok) {
      // Upstream `command_del_client` prints nothing on success and sets
      // client->lifetime = 1 so FR drops it lazily on its next packet (via
      // the timed free — see the function comment).
      logger.info('evictDynamicClient: evicted', { ip, outcome: 'evicted', durationMs });
      return 'evicted';
    }
    if (
      /ENOENT|No such file|Connection refused|Failed connecting|Permission denied/i.test(
        `${combined}\n${result.error ?? ''}`,
      )
    ) {
      logger.warn('evictDynamicClient: control socket unavailable', {
        ip,
        outcome: 'unavailable',
        durationMs,
        error: result.error,
      });
      return 'unavailable';
    }
    logger.warn('evictDynamicClient: radmin failed', {
      ip,
      outcome: 'error',
      durationMs,
      exitCode: result.exitCode,
      stderr: result.stderr.trim(),
      error: result.error,
    });
    return 'error';
  } catch (err) {
    // runRadmin never throws, but keep a defensive net in case of a future
    // refactor — the callers must never propagate a failure up.
    logger.warn('evictDynamicClient: unexpected error', {
      ip,
      outcome: 'error',
      error: (err as Error).message,
    });
    return 'error';
  }
}
