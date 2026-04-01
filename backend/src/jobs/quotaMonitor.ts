import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';
import { notifyVoucherQuotaLow } from '../services/notification.service';

export function startQuotaMonitorJob(): void {
  // Run every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    try {
      const result = await pool.query(`
        SELECT user_id, voucher_quota, vouchers_used
        FROM subscriptions
        WHERE status = 'active'
          AND voucher_quota > 0
          AND vouchers_used::float / voucher_quota >= 0.9
      `);

      for (const row of result.rows) {
        const percentUsed = Math.round((row.vouchers_used / row.voucher_quota) * 100);
        await notifyVoucherQuotaLow(row.user_id, percentUsed);
      }

      logger.info('Quota monitor job completed', { usersNotified: result.rowCount });
    } catch (error) {
      logger.error('Quota monitor job failed', { error });
    }
  });

  logger.info('Quota monitor job scheduled (every 6 hours)');
}
