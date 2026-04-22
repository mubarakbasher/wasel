import { execFile, ExecFileException } from 'child_process';
import { promisify } from 'util';
import logger from '../config/logger';

const execFileAsync = promisify(execFile);

/**
 * Unix-domain socket exposed by FreeRADIUS via the control-socket
 * virtual server (freeradius/raddb/sites-enabled/control-socket). The
 * backend container mounts the parent directory from the freeradius
 * container through the `freeradius_control` named volume.
 */
const RADMIN_SOCKET = '/var/run/freeradius/radmin.sock';

/**
 * How long to wait after the last reload request before actually firing
 * the HUP. Bulk router operations (initial provisioning scripts, admin
 * backfills) can easily touch the nas table a dozen times per second —
 * debouncing coalesces those into one reload so FreeRADIUS isn't
 * thrashing its connection pool.
 */
const DEBOUNCE_MS = 2_000;

let pendingReload: NodeJS.Timeout | null = null;

export interface RadminResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  error?: string;
}

export interface LastReloadStatus {
  attemptedAt: string;
  result: RadminResult;
}

let lastReloadStatus: LastReloadStatus | null = null;

/**
 * Invoke `radmin -f <sock> -e <command>` capturing stdout, stderr, and
 * exit code. A non-zero exit still produces a structured result instead
 * of an opaque exception so callers can surface the real failure reason
 * (socket missing, permission denied, unknown command, etc.).
 */
async function runRadmin(command: string): Promise<RadminResult> {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync('radmin', [
      '-f',
      RADMIN_SOCKET,
      '-e',
      command,
    ]);
    return {
      ok: true,
      stdout: stdout ?? '',
      stderr: stderr ?? '',
      exitCode: 0,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const e = err as ExecFileException & { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: typeof e.code === 'number' ? e.code : null,
      durationMs: Date.now() - started,
      error: e.message,
    };
  }
}

/**
 * Invoke `radmin -e "show clients"` and return stdout. Exposed for use
 * by the router-health probe that checks whether FreeRADIUS has actually
 * picked up a given NAS client. Swallowed errors turn into an empty
 * string so callers can treat "radmin failed" as "not visible".
 */
export async function showFreeradiusClients(): Promise<string> {
  const result = await runRadmin('show clients');
  if (!result.ok) {
    logger.warn('radmin show clients failed', {
      socket: RADMIN_SOCKET,
      exitCode: result.exitCode,
      stderr: result.stderr.trim(),
      error: result.error,
    });
    return '';
  }
  return result.stdout;
}

/**
 * Perform the actual HUP. Non-fatal: we log a warning on failure rather
 * than throwing, because a reload failure should never block a router
 * CRUD operation — the nas row is already committed and an admin can
 * manually retry via POST /admin/freeradius/reload.
 */
async function executeReload(): Promise<RadminResult> {
  const result = await runRadmin('hup');
  lastReloadStatus = {
    attemptedAt: new Date().toISOString(),
    result,
  };
  if (result.ok) {
    logger.info('FreeRADIUS reload triggered via radmin HUP', {
      durationMs: result.durationMs,
    });
  } else {
    logger.warn('FreeRADIUS reload failed (non-fatal)', {
      socket: RADMIN_SOCKET,
      exitCode: result.exitCode,
      stderr: result.stderr.trim(),
      error: result.error,
    });
  }
  return result;
}

/**
 * Request FreeRADIUS to re-read its clients (nas table, clients.conf
 * includes, etc.) so a freshly-inserted NAS row starts authenticating
 * immediately instead of silently rejecting Access-Request packets as
 * "unknown client".
 *
 * Calls within the debounce window are coalesced — only the last call
 * actually fires. Never throws; errors surface only through logs and
 * through `getLastReloadStatus()` / the admin status endpoint.
 */
export async function reloadFreeradiusClients(): Promise<void> {
  if (pendingReload) {
    clearTimeout(pendingReload);
  }

  pendingReload = setTimeout(() => {
    pendingReload = null;
    void executeReload();
  }, DEBOUNCE_MS);
}

/**
 * Trigger an immediate (non-debounced) HUP and return the detailed
 * result. Intended for the admin recovery endpoint — when the debounced
 * path has silently failed in production, an operator needs a way to
 * force a reload and see the real stderr without SSH access.
 */
export async function forceReloadFreeradiusClients(): Promise<RadminResult> {
  if (pendingReload) {
    clearTimeout(pendingReload);
    pendingReload = null;
  }
  return executeReload();
}

/**
 * Return the result of the most recent HUP attempt (debounced or forced).
 * Returns null if no reload has ever been attempted since process start.
 */
export function getLastReloadStatus(): LastReloadStatus | null {
  return lastReloadStatus;
}

/** Exposed for the admin status endpoint. */
export function getRadminSocketPath(): string {
  return RADMIN_SOCKET;
}
