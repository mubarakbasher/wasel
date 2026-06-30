import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';
import { getStats } from '../services/admin.service';

/**
 * Daily cron (00:05 UTC) — compute platform-wide totals and upsert one row
 * into metrics_daily so the admin dashboard trends feature has historical data.
 * Delegates to getStats() to keep numbers consistent between the live stats
 * card and the trends chart.
 */
export function startSnapshotMetricsJob(): void {
  cron.schedule(
    '5 0 * * *',
    async () => {
      try {
        const stats = await getStats();

        const result = await pool.query(
          `INSERT INTO metrics_daily (
             snapshot_date, total_users, active_subscriptions, total_vouchers,
             total_revenue, routers_online, routers_offline, routers_degraded, pending_payments
           )
           VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (snapshot_date) DO UPDATE SET
             total_users          = EXCLUDED.total_users,
             active_subscriptions = EXCLUDED.active_subscriptions,
             total_vouchers       = EXCLUDED.total_vouchers,
             total_revenue        = EXCLUDED.total_revenue,
             routers_online       = EXCLUDED.routers_online,
             routers_offline      = EXCLUDED.routers_offline,
             routers_degraded     = EXCLUDED.routers_degraded,
             pending_payments     = EXCLUDED.pending_payments
           RETURNING snapshot_date`,
          [
            stats.totalUsers,
            stats.subscriptionsByStatus.active ?? 0,
            stats.totalVouchers,
            stats.totalRevenue,
            stats.routersByStatus.online ?? 0,
            stats.routersByStatus.offline ?? 0,
            stats.routersByStatus.degraded ?? 0,
            stats.pendingPayments,
          ],
        );

        const snapshotDate = result.rows[0]?.snapshot_date as string | undefined;
        logger.info('Metrics snapshot written', { date: snapshotDate });
      } catch (error) {
        logger.error('Failed to write metrics snapshot', { error });
      }
    },
    { timezone: 'UTC' },
  );

  logger.info('Metrics snapshot job scheduled (daily)');
}
