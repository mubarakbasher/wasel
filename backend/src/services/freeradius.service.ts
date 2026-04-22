import { execFile, exec, ExecFileException } from 'child_process';
import { promisify } from 'util';
import logger from '../config/logger';
import { pool } from '../config/database';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

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

/**
 * Retry schedule for verify-then-retry on HUP. Each value is a delay in
 * milliseconds between the HUP attempt and the `show clients` verification
 * probe. Total wall-clock ceiling ≈ 5.5 s.
 */
const VERIFY_RETRY_DELAYS_MS = [500, 1500, 3500];

/**
 * Name of the FreeRADIUS container. Used by the escape-hatch hard-restart
 * when radmin HUP has failed to propagate a NAS change. Overridable via env
 * in case the operator renamed the compose service.
 */
const FREERADIUS_CONTAINER = process.env.FREERADIUS_CONTAINER_NAME ?? 'wasel-freeradius';

/**
 * Minimum wall-clock time since the last successful HUP before the escape
 * hatch is willing to `docker restart freeradius`. Prevents a flapping
 * socket from cycling the container every request.
 */
const ESCAPE_HATCH_COOLDOWN_MS = 5 * 60 * 1000;

let pendingReload: NodeJS.Timeout | null = null;
let lastSuccessfulReloadAt: number | null = null;
let lastEscapeHatchAt: number | null = null;

export interface RadminResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  error?: string;
  /** Set when the caller asked us to verify that `expectedNas` is visible. */
  verified?: boolean;
  /** How many HUP attempts it took (1 = first try, >1 = after retry). */
  attempts?: number;
  /** True if the escape-hatch docker restart fired during this call. */
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
 * Perform a `docker restart` on the FreeRADIUS container as a last resort
 * when radmin HUP has repeatedly failed. Requires the backend container
 * to have the Docker socket mounted OR the `docker` CLI to be available
 * with credentials — in practice the VPS deploy gives the backend this
 * via the `DOCKER_HOST`/compose setup.
 *
 * Cooldown-gated: we won't fire this more than once per 5 min.
 */
async function hardRestartFreeradius(): Promise<boolean> {
  const now = Date.now();
  if (lastEscapeHatchAt && now - lastEscapeHatchAt < ESCAPE_HATCH_COOLDOWN_MS) {
    logger.warn('FreeRADIUS escape-hatch suppressed by cooldown', {
      lastFiredAt: new Date(lastEscapeHatchAt).toISOString(),
      cooldownMs: ESCAPE_HATCH_COOLDOWN_MS,
    });
    return false;
  }
  lastEscapeHatchAt = now;
  logger.error('FreeRADIUS escape-hatch: hard-restarting container', {
    container: FREERADIUS_CONTAINER,
  });
  try {
    await execAsync(`docker restart ${FREERADIUS_CONTAINER}`, { timeout: 15_000 });
    logger.info('FreeRADIUS container restarted via escape-hatch', {
      container: FREERADIUS_CONTAINER,
    });
    return true;
  } catch (err) {
    logger.error('FreeRADIUS escape-hatch restart failed', {
      container: FREERADIUS_CONTAINER,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Internal: run HUP, then (if expectedNas supplied) verify the NAS is
 * visible in the running FreeRADIUS client table. Retries on failure.
 */
async function executeReloadInternal(expectedNas?: string): Promise<RadminResult> {
  const started = Date.now();
  let lastResult: RadminResult | null = null;
  let attempt = 0;

  for (; attempt < VERIFY_RETRY_DELAYS_MS.length + 1; attempt++) {
    lastResult = await runRadmin('hup');
    if (!lastResult.ok) {
      // radmin itself failed — no point checking visibility this round.
      if (attempt < VERIFY_RETRY_DELAYS_MS.length) {
        await sleep(VERIFY_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      break;
    }

    if (!expectedNas) {
      // No verification requested — one successful HUP is enough.
      break;
    }

    // Give FreeRADIUS a beat to actually reload the clients table before
    // we probe for the new NAS.
    await sleep(VERIFY_RETRY_DELAYS_MS[Math.min(attempt, VERIFY_RETRY_DELAYS_MS.length - 1)]);

    if (await isNasVisible(expectedNas)) {
      lastResult.verified = true;
      break;
    }
    // Not visible yet — fall through to next retry attempt.
  }

  const result: RadminResult = {
    ...(lastResult ?? { ok: false, stdout: '', stderr: '', exitCode: null, durationMs: 0 }),
    attempts: attempt + (lastResult?.ok && lastResult?.verified ? 1 : attempt),
    durationMs: Date.now() - started,
  };
  // Re-set attempts to a sensible count: number of HUPs fired.
  result.attempts = Math.min(attempt + 1, VERIFY_RETRY_DELAYS_MS.length + 1);

  if (result.ok && (result.verified || !expectedNas)) {
    lastSuccessfulReloadAt = Date.now();
    logger.info('FreeRADIUS reload succeeded', {
      durationMs: result.durationMs,
      attempts: result.attempts,
      verified: result.verified ?? null,
      expectedNas: expectedNas ?? null,
    });
  } else {
    logger.error('FreeRADIUS reload failed after retries', {
      socket: RADMIN_SOCKET,
      exitCode: result.exitCode,
      stderr: result.stderr.trim(),
      error: result.error,
      attempts: result.attempts,
      expectedNas: expectedNas ?? null,
      verified: result.verified ?? false,
    });

    // Escape hatch: if we haven't had a successful reload in a while (or
    // ever), nuke the container. Keep it as a last resort — gated by a
    // 5-minute cooldown to avoid cycle-on-cycle.
    const neverSucceeded = lastSuccessfulReloadAt === null;
    const stale = lastSuccessfulReloadAt !== null && Date.now() - lastSuccessfulReloadAt > ESCAPE_HATCH_COOLDOWN_MS;
    if (neverSucceeded || stale) {
      result.hardRestarted = await hardRestartFreeradius();
      if (result.hardRestarted) {
        // After a hard restart, FreeRADIUS re-reads the nas table at
        // startup so our expectedNas will be picked up in the next few
        // seconds. Mark successful so callers don't double-fire.
        lastSuccessfulReloadAt = Date.now();
      }
    }
  }

  lastReloadStatus = {
    attemptedAt: new Date(started).toISOString(),
    result,
  };
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
 *
 * For the single-router create-path that needs to KNOW the row has been
 * loaded before returning to the caller, use `forceReloadAndVerify()`
 * instead — this function's debounce makes it unsuitable for the happy
 * path.
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
 * Immediate, non-debounced, verify-then-retry reload. Use this in the
 * router create and script-callback paths so the caller gets truthful
 * state: when this resolves, FreeRADIUS has actually loaded the given
 * NAS (or we've escalated to an escape-hatch container restart + logged
 * an error). Never throws — errors are in the returned result.
 */
export async function forceReloadAndVerify(expectedNas: string): Promise<RadminResult> {
  if (pendingReload) {
    clearTimeout(pendingReload);
    pendingReload = null;
  }
  return executeReloadInternal(expectedNas);
}

/**
 * Trigger an immediate (non-debounced) HUP and return the detailed
 * result. Intended for the admin recovery endpoint — when the debounced
 * path has silently failed in production, an operator needs a way to
 * force a reload and see the real stderr without SSH access. Does not
 * verify visibility since the admin may be reloading for reasons other
 * than adding a specific NAS.
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
 * client list and fire a forced HUP if any DB row is missing. Intended
 * to run once at backend boot so a FreeRADIUS cold-start or a missed
 * reload during a backend restart converges back to a consistent state.
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

    logger.warn('FreeRADIUS reconciliation: drift detected, forcing reload', {
      missingCount: missing.length,
      sample: missing.slice(0, 5),
      total: dbRows.rows.length,
    });

    // One forced HUP brings ALL missing rows in at once. We don't verify
    // per-nasname since a cold-started FreeRADIUS may take a second or
    // two to load the full table — the ordinary HUP path + retry is
    // enough for bootstrap.
    await executeReloadInternal();
  } catch (err) {
    logger.warn('FreeRADIUS reconciliation failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
