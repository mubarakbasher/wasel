import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';
import { notifySubscriptionExpiring, notifySubscriptionExpired } from '../services/notification.service';

export function startSubscriptionNotificationJob(): void {
  // Run daily at 09:00 UTC
  cron.schedule('0 9 * * *', async () => {
    try {
      // 1. Subscriptions expiring in 7, 3, 1 days
      const expiringResult = await pool.query(`
        SELECT user_id, end_date
        FROM subscriptions
        WHERE status = 'active'
          AND DATE(end_date) IN (
            CURRENT_DATE + INTERVAL '7 days',
            CURRENT_DATE + INTERVAL '3 days',
            CURRENT_DATE + INTERVAL '1 day'
          )
      `);

      for (const row of expiringResult.rows) {
        const daysLeft = Math.ceil((new Date(row.end_date).getTime() - Date.now()) / 86400000);
        await notifySubscriptionExpiring(row.user_id, daysLeft);
      }

      // 2. Subscriptions that just expired (end_date passed within last 24h)
      const expiredResult = await pool.query(`
        SELECT user_id
        FROM subscriptions
        WHERE status IN ('active', 'expired')
          AND end_date < NOW()
          AND end_date >= NOW() - INTERVAL '1 day'
      `);

      for (const row of expiredResult.rows) {
        await notifySubscriptionExpired(row.user_id);
      }

      logger.info('Subscription notification job completed', {
        expiring: expiringResult.rowCount,
        expired: expiredResult.rowCount,
      });
    } catch (error) {
      logger.error('Subscription notification job failed', { error });
    }
  });

  logger.info('Subscription notification job scheduled (daily 09:00 UTC)');
}
