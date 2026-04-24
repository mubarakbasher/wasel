import { execFile, ExecFileException } from 'child_process';
import { promisify } from 'util';
import logger from '../config/logger';

const execFileAsync = promisify(execFile);

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
  error?: string;
}

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
 * the admin status endpoint. Swallowed errors turn into an empty string so
 * callers can treat "radmin failed" as "not available".
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
