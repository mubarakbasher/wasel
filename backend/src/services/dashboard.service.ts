import { pool } from '../config/database';
import logger from '../config/logger';
import { getActiveSubscription } from './subscription.service';

// ----- Interfaces -----

export interface DashboardData {
  routers: {
    id: string;
    name: string;
    status: string;
    lastSeen: string | null;
  }[];
  subscription: {
    planTier: string;
    planName: string;
    status: string;
    vouchersUsed: number;
    voucherQuota: number;
    startDate: string;
    endDate: string;
    daysRemaining: number;
  } | null;
  vouchersUsedToday: number;
  dailyRevenue: number;
  totalVouchers: number;
  dataUsage24h: {
    totalInput: number;
    totalOutput: number;
  };
  activeSessionsByRouter: {
    routerId: string;
    routerName: string;
    activeSessions: number;
  }[];
}

// ----- Service functions -----

/**
 * Get aggregated dashboard data for a user.
 *
 * Runs multiple queries in parallel for performance.
 */
export async function getDashboardData(userId: string): Promise<DashboardData> {
  const [
    routersResult,
    subscription,
    vouchersUsedTodayResult,
    dailyRevenueResult,
    totalVouchersResult,
    dataUsageResult,
    activeSessionsResult,
  ] = await Promise.all([
    // 1. Routers summary
    pool.query(
      'SELECT id, name, status, last_seen FROM routers WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    ),

    // 2. Active subscription
    getActiveSubscription(userId),

    // 3. Vouchers used today (distinct usernames with sessions started today)
    pool.query(
      `SELECT COUNT(DISTINCT ra.username) AS count
       FROM radacct ra
       JOIN routers r ON ra.nasipaddress = r.tunnel_ip
       JOIN voucher_meta vm ON ra.username = vm.radius_username
       WHERE r.user_id = $1 AND ra.acctstarttime >= CURRENT_DATE`,
      [userId],
    ),

    // 4. Daily revenue (sum of prices of vouchers used today)
    pool.query(
      `SELECT COALESCE(SUM(vm.price), 0) AS total
       FROM radacct ra
       JOIN routers r ON ra.nasipaddress = r.tunnel_ip
       JOIN voucher_meta vm ON ra.username = vm.radius_username
       WHERE r.user_id = $1 AND ra.acctstarttime >= CURRENT_DATE`,
      [userId],
    ),

    // 5. Total vouchers
    pool.query(
      'SELECT COUNT(*) AS count FROM voucher_meta WHERE user_id = $1',
      [userId],
    ),

    // 5. Total data usage (24h)
    pool.query(
      `SELECT COALESCE(SUM(ra.acctinputoctets), 0) AS total_input,
              COALESCE(SUM(ra.acctoutputoctets), 0) AS total_output
       FROM radacct ra
       JOIN routers r ON ra.nasipaddress = r.tunnel_ip
       WHERE r.user_id = $1 AND ra.acctstarttime >= NOW() - INTERVAL '24 hours'`,
      [userId],
    ),

    // 6. Active sessions count per router
    pool.query(
      `SELECT r.id AS router_id, r.name AS router_name, COUNT(ra.radacctid)::int AS active_sessions
       FROM routers r
       LEFT JOIN radacct ra ON ra.nasipaddress = r.tunnel_ip AND ra.acctstoptime IS NULL
       WHERE r.user_id = $1
       GROUP BY r.id, r.name
       ORDER BY r.name`,
      [userId],
    ),
  ]);

  const routers = routersResult.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    lastSeen: row.last_seen ? row.last_seen.toISOString() : null,
  }));

  const subscriptionData = subscription
    ? {
        planTier: subscription.planTier,
        planName: subscription.planName,
        status: subscription.status,
        vouchersUsed: subscription.vouchersUsed,
        voucherQuota: subscription.voucherQuota,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        daysRemaining: subscription.daysRemaining,
      }
    : null;

  const vouchersUsedToday = parseInt(vouchersUsedTodayResult.rows[0].count, 10);
  const dailyRevenue = parseFloat(dailyRevenueResult.rows[0].total);
  const totalVouchers = parseInt(totalVouchersResult.rows[0].count, 10);

  const dataUsage24h = {
    totalInput: parseInt(dataUsageResult.rows[0].total_input, 10),
    totalOutput: parseInt(dataUsageResult.rows[0].total_output, 10),
  };

  const activeSessionsByRouter = activeSessionsResult.rows.map((row: any) => ({
    routerId: row.router_id,
    routerName: row.router_name,
    activeSessions: row.active_sessions,
  }));

  logger.info('Dashboard data retrieved', {
    userId,
    routerCount: routers.length,
    totalVouchers,
    vouchersUsedToday,
  });

  return {
    routers,
    subscription: subscriptionData,
    vouchersUsedToday,
    dailyRevenue,
    totalVouchers,
    dataUsage24h,
    activeSessionsByRouter,
  };
}
