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
 * Runs every 30 seconds.
 */
export function startValidityCoaDisconnectJob(): void {
  cron.schedule('*/30 * * * * *', async () => {
    try {
      // Parse the radcheck Expiration string ("Month DD YYYY HH24:MI:SS",
      // written in UTC by validityExpiration.ts) using to_timestamp, and
      // join the per-NAS shared secret so we can build a CoA packet.
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
    }
  });

  logger.info('Validity CoA disconnect job scheduled (every 30s)');
}
