import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';

export function startPurgeEmailLogJob(): void {
  cron.schedule('30 3 * * *', async () => {
    try {
      const result = await pool.query(
        `DELETE FROM email_log WHERE created_at < NOW() - INTERVAL '90 days'`,
      );

      if (result.rowCount && result.rowCount > 0) {
        logger.info('Purged old email_log rows', { count: result.rowCount });
      }
    } catch (error) {
      logger.error('Failed to purge old email_log rows', { error });
    }
  });

  logger.info('Purge email_log job scheduled (daily)');
}
