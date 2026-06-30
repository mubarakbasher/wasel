import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';

/**
 * Stale-session reaper job.
 *
 * Closes radacct rows for sessions that have not sent an Accounting-Interim-Update
 * for more than 15 minutes. This assumes routers are configured with
 * radius-interim-update=00:05:00 (see wireguardConfig.ts §B hardening). With
 * 5-minute interim updates, a 15-minute threshold allows three missed updates
 * before the row is treated as abandoned.
 *
 * Design constraints:
 *   - acctstoptime is set to COALESCE(acctupdatetime, acctstarttime) — the
 *     last-known-alive time — NOT NOW(). This avoids over-counting
 *     acctsessiontime/octets for time/data vouchers.
 *   - acctsessiontime and octets columns are NOT touched (would cause double-
 *     counting when the router sends a real Stop packet later).
 *   - acctterminatecause is set to 'Reaped-Stale' so closed rows are auditable.
 *
 * Closing a row does not disconnect anyone — it only cleans up the accounting
 * record. On a not-yet-upgraded router (no interim updates configured) this
 * may close a live session's accounting row harmlessly; it self-corrects once
 * the router gets interim updates via template re-apply or health remediation.
 *
 * NOTE: a reaped row's acctsessiontime is intentionally left frozen at its last
 * interim value so usage sums (time/data limits) are not inflated by the gap
 * between the last interim update and the reaper run.  The reaper deliberately
 * sends NO CoA Disconnect-Request — the session is already gone from the router's
 * perspective; the only goal is to free the Simultaneous-Use slot so the voucher
 * owner can reconnect.
 *
 * Runs every 2 minutes.
 */
export function startStaleSessionReaperJob(): void {
  cron.schedule('0 */2 * * * *', async () => {
    try {
      const result = await pool.query(`
        UPDATE radacct
        SET acctstoptime = COALESCE(acctupdatetime, acctstarttime),
            acctterminatecause = 'Reaped-Stale'
        WHERE acctstoptime IS NULL
          AND COALESCE(acctupdatetime, acctstarttime) < NOW() - INTERVAL '15 minutes'
      `);

      const rowCount = result.rowCount ?? 0;
      if (rowCount > 0) {
        logger.info('Stale session reaper: closed stale accounting rows', { rowCount });
      }
    } catch (error) {
      logger.error('Stale session reaper job failed', { error });
    }
  });

  logger.info('Stale session reaper job scheduled (every 2 minutes)');
}
