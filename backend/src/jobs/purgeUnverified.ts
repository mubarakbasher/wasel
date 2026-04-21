import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';

export function startPurgeUnverifiedJob(): void {
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await pool.query(
        `DELETE FROM users
         WHERE is_verified = FALSE
           AND created_at < NOW() - INTERVAL '72 hours'`,
      );

      if (result.rowCount && result.rowCount > 0) {
        // Deliberately log only the count — emails of purged users are PII
        // and would live in the log retention window indefinitely otherwise.
        logger.info('Purged unverified accounts', { count: result.rowCount });
      }
    } catch (error) {
      logger.error('Failed to purge unverified accounts', { error });
    }
  });

  logger.info('Purge unverified accounts job scheduled (hourly)');
}
