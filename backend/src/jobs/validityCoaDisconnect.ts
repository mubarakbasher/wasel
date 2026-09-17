import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';
import { sendDisconnectRequest } from '../services/radclient.service';

/**
 * Validity CoA-disconnect job.
 *
 * For vouchers whose validity window (radcheck Expiration row written by the
 * validityExpiration job) has elapsed AND that still have an active session
 * (radacct row with acctstoptime IS NULL), this job sends a RFC 5176
 * Disconnect-Request to the router so the active session is terminated
 * immediately.
 *
 * Without this job, an expired voucher's active session would continue until
 * the router's idle-timeout fires or the user manually disconnects — even
 * though rlm_expiration would correctly reject any *new* Access-Request.
 *
 * Runs every 30 seconds. Capped at 200 rows per tick (matches
 * dataUsageCoaDisconnect) to prevent runaway radclient spawns on large backlogs.
 * The in-flight guard prevents a slow tick from overlapping the next one.
 */

// In-flight guard: set true while a tick is executing so that a slow DB query
// or radclient call cannot cause two ticks to overlap (matches
// dataUsageCoaDisconnect.ts pattern).
let running = false;

export function startValidityCoaDisconnectJob(): void {
  cron.schedule('*/30 * * * * *', async () => {
    if (running) return;
    running = true;
    try {
      // Parse the radcheck Expiration string ("Month DD YYYY HH24:MI:SS",
      // written in UTC by validityExpiration.ts) using to_timestamp, and
      // join the per-NAS shared secret so we can build a CoA packet.
      // LIMIT 200 per tick prevents runaway radclient spawns on large backlogs;
      // the job re-fires every 30 s until all expired sessions are cleared.
      const result = await pool.query<{
        username: string;
        nasipaddress: string;
        acctsessionid: string;
        framedipaddress: string | null;
        secret: string;
      }>(`
        SELECT vm.radius_username AS username,
               ra.nasipaddress,
               ra.acctsessionid,
               ra.framedipaddress,
               n.secret
        FROM voucher_meta vm
        JOIN radcheck rc
          ON rc.username = vm.radius_username
         AND rc.attribute = 'Expiration'
        JOIN radacct ra
          ON ra.username = vm.radius_username
         AND ra.acctstoptime IS NULL
        JOIN nas n
          ON n.nasname = ra.nasipaddress
        WHERE vm.status NOT IN ('disabled')
          AND to_timestamp(rc.value, 'Month DD YYYY HH24:MI:SS')
              AT TIME ZONE 'UTC' < NOW()
        LIMIT 200
      `);

      if (result.rows.length === 0) return;

      for (const row of result.rows) {
        const outcome = await sendDisconnectRequest({
          secret: row.secret,
          nasIp: row.nasipaddress,
          username: row.username,
          acctSessionId: row.acctsessionid,
          framedIp: row.framedipaddress ?? undefined,
        });

        logger.info('Validity CoA disconnect dispatched', {
          username: row.username,
          nasIp: row.nasipaddress,
          acctSessionId: row.acctsessionid,
          outcome,
        });
      }
    } catch (error) {
      logger.error('Validity CoA disconnect job failed', { error });
    } finally {
      running = false;
    }
  });

  logger.info('Validity CoA disconnect job scheduled (every 30s)');
}

/** Reset module-level state. Exported for tests only. */
export function _resetJobState(): void {
  running = false;
}
