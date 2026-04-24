import { execFile, ExecFileException } from 'child_process';
import { promisify } from 'util';
import logger from '../config/logger';

const execFileAsync = promisify(execFile);

/**
 * Unix-domain socket exposed by FreeRADIUS via the control-socket virtual
 * server (freeradius/raddb/sites-enabled/control-socket). The backend
 * container mounts the parent directory from the freeradius container
 * through the `freeradius_control` named volume.
 *
 * Used only by the router-health probe's `show clients` call. New routers
 * no longer need any reload/HUP/docker-restart round-trip — FreeRADIUS
 * picks them up on their first Access-Request via the dynamic_clients
 * path configured in freeradius/raddb/sites-enabled/dynamic-clients.
 */
const RADMIN_SOCKET = '/var/run/freeradius/radmin.sock';

export interface RadminResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  error?: string;
}

/**
 * Invoke `radmin -f <sock> -e <command>` capturing stdout, stderr, and
 * exit code. A non-zero exit still produces a structured result instead
 * of an opaque exception so callers can surface the real failure reason.
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
 * Invoke `radmin -e "show clients"` and return stdout. Exposed for the
 * admin status endpoint; no other callers consume it now that the
 * per-router freeradius-sees-NAS probe has been removed (with dynamic
 * clients a freshly-added NAS isn't in the output until its first real
 * auth attempt, so the signal was misleading). Errors turn into an empty
 * string so the admin UI renders "no clients loaded" rather than
 * crashing.
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

/** Exposed for the admin status endpoint. */
export function getRadminSocketPath(): string {
  return RADMIN_SOCKET;
}
