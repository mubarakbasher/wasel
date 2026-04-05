import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';

/**
 * Validity-from-first-use job.
 *
 * For vouchers with validity_seconds > 0, this job detects the first login
 * (via radacct) and sets the Expiration attribute in radcheck so the voucher
 * expires after the validity period from first use.
 *
 * Runs every 30 seconds.
 */
export function startValidityExpirationJob(): void {
  cron.schedule('*/30 * * * * *', async () => {
    try {
      // Find vouchers that have validity but no Expiration set yet,
      // and the user has logged in at least once (has a radacct record).
      const result = await pool.query<{
        radius_username: string;
        validity_seconds: number;
        first_login: Date;
      }>(`
        SELECT vm.radius_username, vm.validity_seconds,
               MIN(ra.acctstarttime) AS first_login
        FROM voucher_meta vm
        JOIN radacct ra ON ra.username = vm.radius_username
        WHERE vm.validity_seconds IS NOT NULL
          AND vm.validity_seconds > 0
          AND vm.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM radcheck rc
            WHERE rc.username = vm.radius_username
              AND rc.attribute = 'Expiration'
          )
        GROUP BY vm.radius_username, vm.validity_seconds
      `);

      if (result.rows.length === 0) return;

      const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

      for (const row of result.rows) {
        const expDate = new Date(row.first_login.getTime() + row.validity_seconds * 1000);
        const formatted = `${months[expDate.getUTCMonth()]} ${String(expDate.getUTCDate()).padStart(2, '0')} ${expDate.getUTCFullYear()} ${String(expDate.getUTCHours()).padStart(2, '0')}:${String(expDate.getUTCMinutes()).padStart(2, '0')}:${String(expDate.getUTCSeconds()).padStart(2, '0')}`;

        await pool.query(
          'INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)',
          [row.radius_username, 'Expiration', ':=', formatted],
        );

        logger.info('Validity expiration set', {
          username: row.radius_username,
          firstLogin: row.first_login.toISOString(),
          expiration: formatted,
          validitySeconds: row.validity_seconds,
        });
      }
    } catch (error) {
      logger.error('Validity expiration job failed', { error });
    }
  });

  logger.info('Validity expiration job scheduled (every 30s)');
}
