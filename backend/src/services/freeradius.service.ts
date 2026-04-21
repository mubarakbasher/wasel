import { execFile } from 'child_process';
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

/**
 * Invoke `radmin -f <sock> -e "show clients"` and return stdout. Exposed
 * for use by the router-health probe that checks whether FreeRADIUS has
 * actually picked up a given NAS client. Swallowed errors turn into an
 * empty string so callers can treat "radmin failed" as "not visible".
 */
export async function showFreeradiusClients(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('radmin', [
      '-f',
      RADMIN_SOCKET,
      '-e',
      'show clients',
    ]);
    return stdout;
  } catch (error) {
    logger.warn('radmin show clients failed', {
      socket: RADMIN_SOCKET,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

/**
 * Perform the actual HUP. Non-fatal: we log a warning on failure rather
 * than throwing, because a reload failure should never block a router
 * CRUD operation — the nas row is already committed and the next
 * scheduled reload (or a manual `docker compose kill -s HUP freeradius`)
 * will eventually catch up.
 */
async function executeReload(): Promise<void> {
  try {
    await execFileAsync('radmin', ['-f', RADMIN_SOCKET, '-e', 'hup']);
    logger.info('FreeRADIUS reload triggered via radmin HUP');
  } catch (error) {
    logger.warn('FreeRADIUS reload failed (non-fatal)', {
      socket: RADMIN_SOCKET,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Request FreeRADIUS to re-read its clients (nas table, clients.conf
 * includes, etc.) so a freshly-inserted NAS row starts authenticating
 * immediately instead of silently rejecting Access-Request packets as
 * "unknown client".
 *
 * Calls within the debounce window are coalesced — only the last call
 * actually fires. Never throws; errors surface only through logs.
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
