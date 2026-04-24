import { execFile, exec, ExecFileException } from 'child_process';
import { promisify } from 'util';
import logger from '../config/logger';
import { pool } from '../config/database';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/**
 * Unix-domain socket exposed by FreeRADIUS via the control-socket virtual
 * server (freeradius/raddb/sites-enabled/control-socket). The backend
 * container mounts the parent directory from the freeradius container
 * through the `freeradius_control` named volume.
 *
 * We use this socket only for `radmin -e "show clients"` probes now — not
 * for reloads. FreeRADIUS 3.2.4 does not re-read SQL-loaded dynamic
 * clients on HUP, so a full container restart is the only reliable path
 * to pick up a freshly-inserted `nas` row.
 */
const RADMIN_SOCKET = '/var/run/freeradius/radmin.sock';

/**
 * Coalesce bursts of NAS writes into one restart. When a script imports
 * three routers in rapid succession, each write calls
 * `reloadFreeradiusClients()`; within this window only the last call
 * actually fires, so FR restarts once instead of three times.
 */
const DEBOUNCE_MS = 2_000;

/**
 * How long to wait for FreeRADIUS to come back up and load the nas table
 * after a `docker restart`. Poll `isNasVisible()` every 500ms until the
 * expected NAS appears. 15s is generous — a healthy 3.2.4 container boots
 * in 2-4 seconds.
 */
const POST_RESTART_WAIT_MS = 15_000;
const POST_RESTART_POLL_MS = 500;

/**
 * Name of the FreeRADIUS container to restart. Overridable via env in
 * case the operator renamed the compose service.
 */
const FREERADIUS_CONTAINER = process.env.FREERADIUS_CONTAINER_NAME ?? 'wasel-freeradius';

let pendingReload: NodeJS.Timeout | null = null;

export interface RadminResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  error?: string;
  /** Set when the caller asked us to verify that `expectedNas` is visible. */
  verified?: boolean;
  /** Kept for backwards-compat with the admin status endpoint. Always 1 for docker restart. */
  attempts?: number;
  /** True when a docker-restart actually ran during this call. Always true on the new path. */
  hardRestarted?: boolean;
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
 * Invoke `radmin -e "show clients"` and return stdout. Exposed for use by
 * the router-health probe that checks whether FreeRADIUS has actually
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
 * Check whether FreeRADIUS's in-memory client list contains a given
 * nasname. Word-boundary match so 10.10.0.2 doesn't match 10.10.0.20.
 */
async function isNasVisible(expectedNas: string): Promise<boolean> {
  const output = await showFreeradiusClients();
  if (!output) return false;
  const escaped = expectedNas.replace(/\./g, '\\.');
  return new RegExp(`\\b${escaped}\\b`).test(output);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `docker restart <FREERADIUS_CONTAINER>`. Requires /var/run/docker.sock
 * to be mounted into this container and the `docker` CLI in the image —
 * both wired up by docker-compose.yml + backend/Dockerfile.
 *
 * Returns a RadminResult-shaped object so executeReloadInternal callers
 * and the admin status endpoint keep rendering the same fields.
 */
async function dockerRestartFreeradius(): Promise<RadminResult> {
  const started = Date.now();
  logger.info('FreeRADIUS: issuing docker restart', { container: FREERADIUS_CONTAINER });
  try {
    const { stdout, stderr } = await execAsync(`docker restart ${FREERADIUS_CONTAINER}`, {
      timeout: 20_000,
    });
    return {
      ok: true,
      stdout: stdout ?? '',
      stderr: stderr ?? '',
      exitCode: 0,
      durationMs: Date.now() - started,
      attempts: 1,
      hardRestarted: true,
    };
  } catch (err) {
    const e = err as ExecFileException & { stdout?: string; stderr?: string };
    const stderr = (e.stderr ?? '').trim();
    const combined = `${stderr}\n${e.message ?? ''}`;

    // Classify the two most common failure modes so operators see an
    // actionable line in the logs instead of a raw exec dump.
    let diagnosis: string | undefined;
    if (/permission denied/i.test(combined) && /docker\.sock/i.test(combined)) {
      diagnosis =
        'backend user cannot access /var/run/docker.sock — verify docker-entrypoint.sh '
        + 'resolves the host docker group GID and adds `app` to it, and that '
        + 'docker-compose mounts /var/run/docker.sock into the backend service';
    } else if (/command not found|not found.*docker/i.test(combined) || e.code === 127) {
      diagnosis = 'docker CLI is missing from the backend image — rebuild with docker-cli apk package';
    } else if (/Cannot connect to the Docker daemon/i.test(combined)) {
      diagnosis =
        'docker daemon unreachable — /var/run/docker.sock is not mounted or the daemon is down on the host';
    }

    logger.error('FreeRADIUS: docker restart failed', {
      container: FREERADIUS_CONTAINER,
      exitCode: e.code ?? null,
      stderr,
      error: e.message,
      diagnosis,
    });
    return {
      ok: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: typeof e.code === 'number' ? e.code : null,
      durationMs: Date.now() - started,
      error: diagnosis ? `${diagnosis} (${e.message})` : e.message,
      attempts: 1,
      hardRestarted: false,
    };
  }
}

/**
 * Restart FreeRADIUS, then (if expectedNas supplied) poll until the NAS
 * appears in `show clients` or we hit the POST_RESTART_WAIT_MS ceiling.
 */
async function executeReloadInternal(expectedNas?: string): Promise<RadminResult> {
  const result = await dockerRestartFreeradius();

  if (!result.ok) {
    // docker CLI missing, socket not mounted, or daemon unreachable.
    // Nothing else we can try from inside the backend container.
    lastReloadStatus = { attemptedAt: new Date().toISOString(), result };
    return result;
  }

  if (!expectedNas) {
    logger.info('FreeRADIUS restarted (no NAS verification requested)', {
      durationMs: result.durationMs,
    });
    lastReloadStatus = { attemptedAt: new Date().toISOString(), result };
    return result;
  }

  // Poll until FR is back up and the NAS is visible, or we give up.
  const pollStart = Date.now();
  const deadline = pollStart + POST_RESTART_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POST_RESTART_POLL_MS);
    if (await isNasVisible(expectedNas)) {
      result.verified = true;
      logger.info('FreeRADIUS restarted and NAS visible', {
        expectedNas,
        restartMs: result.durationMs,
        waitMs: Date.now() - pollStart,
      });
      lastReloadStatus = { attemptedAt: new Date().toISOString(), result };
      return result;
    }
  }

  // Restart succeeded but the NAS never showed up — the row may have been
  // deleted between the write and the restart, or radmin is broken.
  result.verified = false;
  logger.warn('FreeRADIUS restarted but NAS did not appear in show clients', {
    expectedNas,
    restartMs: result.durationMs,
    waitMs: Date.now() - pollStart,
  });
  lastReloadStatus = { attemptedAt: new Date().toISOString(), result };
  return result;
}

/**
 * Request FreeRADIUS to re-read its clients (nas table, clients.conf
 * includes, etc.) so a freshly-inserted NAS row starts authenticating
 * immediately. Calls within DEBOUNCE_MS are coalesced — only the last
 * call actually fires. Never throws; errors surface through logs and
 * `getLastReloadStatus()`.
 *
 * Use this from fire-and-forget call sites (update, delete) where the
 * caller doesn't need to know the NAS is loaded before returning. For
 * paths that must verify (create, finalize), use `forceReloadAndVerify()`.
 */
export async function reloadFreeradiusClients(): Promise<void> {
  if (pendingReload) {
    clearTimeout(pendingReload);
  }

  pendingReload = setTimeout(() => {
    pendingReload = null;
    void executeReloadInternal();
  }, DEBOUNCE_MS);
}

/**
 * Immediate, non-debounced, verify-after-restart reload. Use this in the
 * router create and finalize paths so the caller gets truthful state:
 * when this resolves, FreeRADIUS has been restarted and (if ok) the NAS
 * is visible in its in-memory client list. Never throws — errors surface
 * in the returned result.
 */
export async function forceReloadAndVerify(expectedNas: string): Promise<RadminResult> {
  if (pendingReload) {
    clearTimeout(pendingReload);
    pendingReload = null;
  }
  return executeReloadInternal(expectedNas);
}

/**
 * Trigger an immediate (non-debounced) restart and return the detailed
 * result. Intended for the admin recovery endpoint — when the debounced
 * path has silently failed in production, an operator needs a way to
 * force a reload and see the real stderr without SSH access.
 */
export async function forceReloadFreeradiusClients(): Promise<RadminResult> {
  if (pendingReload) {
    clearTimeout(pendingReload);
    pendingReload = null;
  }
  return executeReloadInternal();
}

/**
 * Compare the `nas` table in PostgreSQL against FreeRADIUS's in-memory
 * client list and fire a restart if any DB row is missing. Runs once at
 * backend boot so a FreeRADIUS cold-start or a missed reload during a
 * backend restart converges back to a consistent state.
 *
 * Gated: if radmin is not responding (FreeRADIUS still booting), skip —
 * depends_on and the container's own startup will load the nas table at
 * startup time, so no restart is needed. Restarting an already-booting
 * container would just extend the window where vouchers can't auth.
 *
 * Non-fatal: logs and swallows all errors. Callers should `void` it or
 * catch to avoid blocking server startup on RADIUS issues.
 */
export async function reconcileNasOnStartup(): Promise<void> {
  try {
    const dbRows = await pool.query<{ nasname: string }>('SELECT nasname FROM nas');
    if (dbRows.rows.length === 0) {
      logger.info('FreeRADIUS reconciliation: nas table is empty, skipping');
      return;
    }

    const memory = await showFreeradiusClients();
    if (!memory) {
      // radmin unavailable — FR probably booting. It will load the nas
      // table itself as part of startup; don't restart.
      logger.info('FreeRADIUS reconciliation: radmin not responding (FR booting?), skipping', {
        dbRowCount: dbRows.rows.length,
      });
      return;
    }

    const missing = dbRows.rows
      .map((r) => r.nasname)
      .filter((ip) => {
        const escaped = ip.replace(/\./g, '\\.');
        return !new RegExp(`\\b${escaped}\\b`).test(memory);
      });

    if (missing.length === 0) {
      logger.info('FreeRADIUS reconciliation: all nas rows visible', {
        total: dbRows.rows.length,
      });
      return;
    }

    logger.warn('FreeRADIUS reconciliation: drift detected, restarting', {
      missingCount: missing.length,
      sample: missing.slice(0, 5),
      total: dbRows.rows.length,
    });

    await executeReloadInternal();
  } catch (err) {
    logger.warn('FreeRADIUS reconciliation failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Return the result of the most recent restart attempt (debounced or
 * forced). Returns null if no reload has ever been attempted since
 * process start.
 */
export function getLastReloadStatus(): LastReloadStatus | null {
  return lastReloadStatus;
}

/** Exposed for the admin status endpoint. */
export function getRadminSocketPath(): string {
  return RADMIN_SOCKET;
}
