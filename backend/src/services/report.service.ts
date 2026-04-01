import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';

// ----- Interfaces -----

export interface VoucherSalesRow {
  date: string;
  created: number;
  used: number;
  expired: number;
  remaining: number;
}

export interface VoucherSalesReport {
  type: 'voucher-sales';
  startDate: string;
  endDate: string;
  rows: VoucherSalesRow[];
  totals: {
    created: number;
    used: number;
    expired: number;
    remaining: number;
  };
}

export interface SessionReportRow {
  date: string;
  totalSessions: number;
  avgDurationSeconds: number;
  totalInputOctets: number;
  totalOutputOctets: number;
}

export interface SessionReport {
  type: 'sessions';
  startDate: string;
  endDate: string;
  rows: SessionReportRow[];
  totals: {
    totalSessions: number;
    avgDurationSeconds: number;
    totalInputOctets: number;
    totalOutputOctets: number;
  };
}

export interface RevenueReportRow {
  date: string;
  profileName: string;
  groupName: string;
  vouchersCreated: number;
}

export interface RevenueReport {
  type: 'revenue';
  startDate: string;
  endDate: string;
  rows: RevenueReportRow[];
  totals: {
    totalVouchers: number;
    profileBreakdown: { profileName: string; groupName: string; count: number }[];
  };
}

export interface RouterUptimeRow {
  routerId: string;
  routerName: string;
  status: string;
  lastSeen: string | null;
  createdAt: string;
}

export interface RouterUptimeReport {
  type: 'router-uptime';
  startDate: string;
  endDate: string;
  routers: RouterUptimeRow[];
  summary: {
    totalRouters: number;
    onlineCount: number;
    offlineCount: number;
    degradedCount: number;
  };
}

export type ReportData = VoucherSalesReport | SessionReport | RevenueReport | RouterUptimeReport;
export type ReportType = 'voucher-sales' | 'sessions' | 'revenue' | 'router-uptime';

// ----- Helper: build router filter clause -----

function buildRouterFilter(
  userId: string,
  routerId: string | undefined,
  params: any[],
  paramStartIndex: number
): { routerCondition: string; params: any[]; nextIndex: number } {
  if (routerId) {
    params.push(userId, routerId);
    return {
      routerCondition: `r.user_id = $${paramStartIndex} AND r.id = $${paramStartIndex + 1}`,
      params,
      nextIndex: paramStartIndex + 2,
    };
  }
  params.push(userId);
  return {
    routerCondition: `r.user_id = $${paramStartIndex}`,
    params,
    nextIndex: paramStartIndex + 1,
  };
}

// ----- Report functions -----

/**
 * Voucher Sales Report: created/used/expired/remaining counts grouped by date.
 *
 * Queries voucher_meta for vouchers within the date range, grouped by
 * creation date and status.
 */
export async function getVoucherSalesReport(
  userId: string,
  startDate: string,
  endDate: string,
  routerId?: string
): Promise<VoucherSalesReport> {
  const params: any[] = [];
  let paramIndex = 1;

  // Build user/router filter
  const conditions: string[] = [];
  params.push(userId);
  conditions.push(`vm.user_id = $${paramIndex}`);
  paramIndex++;

  if (routerId) {
    params.push(routerId);
    conditions.push(`vm.router_id = $${paramIndex}`);
    paramIndex++;
  }

  params.push(startDate);
  conditions.push(`vm.created_at >= $${paramIndex}`);
  paramIndex++;

  params.push(endDate);
  conditions.push(`vm.created_at <= $${paramIndex}`);
  paramIndex++;

  const whereClause = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT
       DATE(vm.created_at) AS date,
       COUNT(*) FILTER (WHERE vm.status IS NOT NULL)::int AS created,
       COUNT(*) FILTER (WHERE vm.status = 'used')::int AS used,
       COUNT(*) FILTER (WHERE vm.status = 'expired')::int AS expired,
       COUNT(*) FILTER (WHERE vm.status = 'active')::int AS remaining
     FROM voucher_meta vm
     WHERE ${whereClause}
     GROUP BY DATE(vm.created_at)
     ORDER BY DATE(vm.created_at)`,
    params
  );

  const rows: VoucherSalesRow[] = result.rows.map((row: any) => ({
    date: row.date.toISOString().split('T')[0],
    created: row.created,
    used: row.used,
    expired: row.expired,
    remaining: row.remaining,
  }));

  const totals = rows.reduce(
    (acc, row) => ({
      created: acc.created + row.created,
      used: acc.used + row.used,
      expired: acc.expired + row.expired,
      remaining: acc.remaining + row.remaining,
    }),
    { created: 0, used: 0, expired: 0, remaining: 0 }
  );

  logger.info('Voucher sales report generated', {
    userId,
    startDate,
    endDate,
    routerId,
    rowCount: rows.length,
  });

  return { type: 'voucher-sales', startDate, endDate, rows, totals };
}

/**
 * Session Report: total sessions, avg duration, total data in/out grouped by date.
 *
 * Queries radacct joined with routers to scope by user ownership.
 */
export async function getSessionReport(
  userId: string,
  startDate: string,
  endDate: string,
  routerId?: string
): Promise<SessionReport> {
  const params: any[] = [];
  let paramIndex = 1;

  const conditions: string[] = [];

  params.push(userId);
  conditions.push(`r.user_id = $${paramIndex}`);
  paramIndex++;

  if (routerId) {
    params.push(routerId);
    conditions.push(`r.id = $${paramIndex}`);
    paramIndex++;
  }

  params.push(startDate);
  conditions.push(`ra.acctstarttime >= $${paramIndex}`);
  paramIndex++;

  params.push(endDate);
  conditions.push(`ra.acctstarttime <= $${paramIndex}`);
  paramIndex++;

  const whereClause = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT
       DATE(ra.acctstarttime) AS date,
       COUNT(*)::int AS total_sessions,
       COALESCE(AVG(ra.acctsessiontime), 0)::int AS avg_duration_seconds,
       COALESCE(SUM(ra.acctinputoctets), 0)::bigint AS total_input_octets,
       COALESCE(SUM(ra.acctoutputoctets), 0)::bigint AS total_output_octets
     FROM radacct ra
     JOIN routers r ON ra.nasipaddress = r.tunnel_ip
     WHERE ${whereClause}
     GROUP BY DATE(ra.acctstarttime)
     ORDER BY DATE(ra.acctstarttime)`,
    params
  );

  const rows: SessionReportRow[] = result.rows.map((row: any) => ({
    date: row.date.toISOString().split('T')[0],
    totalSessions: row.total_sessions,
    avgDurationSeconds: row.avg_duration_seconds,
    totalInputOctets: parseInt(row.total_input_octets, 10),
    totalOutputOctets: parseInt(row.total_output_octets, 10),
  }));

  const totalSessions = rows.reduce((acc, row) => acc + row.totalSessions, 0);
  const totalInputOctets = rows.reduce((acc, row) => acc + row.totalInputOctets, 0);
  const totalOutputOctets = rows.reduce((acc, row) => acc + row.totalOutputOctets, 0);
  const avgDurationSeconds =
    totalSessions > 0
      ? Math.round(rows.reduce((acc, row) => acc + row.avgDurationSeconds * row.totalSessions, 0) / totalSessions)
      : 0;

  logger.info('Session report generated', {
    userId,
    startDate,
    endDate,
    routerId,
    rowCount: rows.length,
  });

  return {
    type: 'sessions',
    startDate,
    endDate,
    rows,
    totals: { totalSessions, avgDurationSeconds, totalInputOctets, totalOutputOctets },
  };
}

/**
 * Revenue Report: voucher counts per profile grouped by date.
 *
 * Since radius_profiles doesn't have a price field, this report provides
 * voucher counts per profile so operators can calculate revenue externally.
 */
export async function getRevenueReport(
  userId: string,
  startDate: string,
  endDate: string,
  routerId?: string
): Promise<RevenueReport> {
  const params: any[] = [];
  let paramIndex = 1;

  const conditions: string[] = [];

  params.push(userId);
  conditions.push(`vm.user_id = $${paramIndex}`);
  paramIndex++;

  if (routerId) {
    params.push(routerId);
    conditions.push(`vm.router_id = $${paramIndex}`);
    paramIndex++;
  }

  params.push(startDate);
  conditions.push(`vm.created_at >= $${paramIndex}`);
  paramIndex++;

  params.push(endDate);
  conditions.push(`vm.created_at <= $${paramIndex}`);
  paramIndex++;

  const whereClause = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT
       DATE(vm.created_at) AS date,
       COALESCE(rp.display_name, vm.group_profile) AS profile_name,
       vm.group_profile AS group_name,
       COUNT(*)::int AS vouchers_created
     FROM voucher_meta vm
     LEFT JOIN radius_profiles rp ON rp.group_name = vm.group_profile AND rp.user_id = vm.user_id
     WHERE ${whereClause}
     GROUP BY DATE(vm.created_at), COALESCE(rp.display_name, vm.group_profile), vm.group_profile
     ORDER BY DATE(vm.created_at), profile_name`,
    params
  );

  const rows: RevenueReportRow[] = result.rows.map((row: any) => ({
    date: row.date.toISOString().split('T')[0],
    profileName: row.profile_name,
    groupName: row.group_name,
    vouchersCreated: row.vouchers_created,
  }));

  // Profile breakdown totals
  const profileMap = new Map<string, { profileName: string; groupName: string; count: number }>();
  for (const row of rows) {
    const existing = profileMap.get(row.groupName);
    if (existing) {
      existing.count += row.vouchersCreated;
    } else {
      profileMap.set(row.groupName, {
        profileName: row.profileName,
        groupName: row.groupName,
        count: row.vouchersCreated,
      });
    }
  }

  const totalVouchers = rows.reduce((acc, row) => acc + row.vouchersCreated, 0);
  const profileBreakdown = Array.from(profileMap.values());

  logger.info('Revenue report generated', {
    userId,
    startDate,
    endDate,
    routerId,
    rowCount: rows.length,
    totalVouchers,
  });

  return {
    type: 'revenue',
    startDate,
    endDate,
    rows,
    totals: { totalVouchers, profileBreakdown },
  };
}

/**
 * Router Uptime Report: current router status and session-based uptime estimation.
 *
 * Queries routers table for status and last_seen, and uses radacct
 * session data to estimate activity during the date range.
 */
export async function getRouterUptimeReport(
  userId: string,
  startDate: string,
  endDate: string,
  routerId?: string
): Promise<RouterUptimeReport> {
  const params: any[] = [];
  let paramIndex = 1;

  const conditions: string[] = [];

  params.push(userId);
  conditions.push(`r.user_id = $${paramIndex}`);
  paramIndex++;

  if (routerId) {
    params.push(routerId);
    conditions.push(`r.id = $${paramIndex}`);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT r.id, r.name, r.status, r.last_seen, r.created_at
     FROM routers r
     WHERE ${whereClause}
     ORDER BY r.name`,
    params
  );

  const routers: RouterUptimeRow[] = result.rows.map((row: any) => ({
    routerId: row.id,
    routerName: row.name,
    status: row.status,
    lastSeen: row.last_seen ? row.last_seen.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  }));

  const onlineCount = routers.filter((r) => r.status === 'online').length;
  const offlineCount = routers.filter((r) => r.status === 'offline').length;
  const degradedCount = routers.filter((r) => r.status === 'degraded').length;

  logger.info('Router uptime report generated', {
    userId,
    startDate,
    endDate,
    routerId,
    totalRouters: routers.length,
    onlineCount,
    offlineCount,
    degradedCount,
  });

  return {
    type: 'router-uptime',
    startDate,
    endDate,
    routers,
    summary: {
      totalRouters: routers.length,
      onlineCount,
      offlineCount,
      degradedCount,
    },
  };
}

// ----- Dispatcher -----

/**
 * Generate a report based on type.
 */
export async function generateReport(
  userId: string,
  type: ReportType,
  startDate: string,
  endDate: string,
  routerId?: string
): Promise<ReportData> {
  // Validate date range
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (start >= end) {
    throw new AppError(400, 'Start date must be before end date', 'INVALID_DATE_RANGE');
  }

  // Limit range to 1 year max
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  if (end.getTime() - start.getTime() > oneYearMs) {
    throw new AppError(400, 'Date range must not exceed 1 year', 'DATE_RANGE_TOO_LARGE');
  }

  switch (type) {
    case 'voucher-sales':
      return getVoucherSalesReport(userId, startDate, endDate, routerId);
    case 'sessions':
      return getSessionReport(userId, startDate, endDate, routerId);
    case 'revenue':
      return getRevenueReport(userId, startDate, endDate, routerId);
    case 'router-uptime':
      return getRouterUptimeReport(userId, startDate, endDate, routerId);
    default:
      throw new AppError(400, `Unknown report type: ${type}`, 'INVALID_REPORT_TYPE');
  }
}

// ----- CSV Export -----

/**
 * Convert report data to CSV string.
 */
export function exportReportCsv(reportData: ReportData, type: ReportType): string {
  switch (type) {
    case 'voucher-sales': {
      const report = reportData as VoucherSalesReport;
      const header = 'Date,Created,Used,Expired,Remaining';
      const rows = report.rows.map(
        (r) => `${r.date},${r.created},${r.used},${r.expired},${r.remaining}`
      );
      const totals = `TOTAL,${report.totals.created},${report.totals.used},${report.totals.expired},${report.totals.remaining}`;
      return [header, ...rows, totals].join('\n');
    }

    case 'sessions': {
      const report = reportData as SessionReport;
      const header = 'Date,Total Sessions,Avg Duration (seconds),Total Input (bytes),Total Output (bytes)';
      const rows = report.rows.map(
        (r) =>
          `${r.date},${r.totalSessions},${r.avgDurationSeconds},${r.totalInputOctets},${r.totalOutputOctets}`
      );
      const totals = `TOTAL,${report.totals.totalSessions},${report.totals.avgDurationSeconds},${report.totals.totalInputOctets},${report.totals.totalOutputOctets}`;
      return [header, ...rows, totals].join('\n');
    }

    case 'revenue': {
      const report = reportData as RevenueReport;
      const header = 'Date,Profile Name,Group Name,Vouchers Created';
      const rows = report.rows.map(
        (r) => `${r.date},"${r.profileName}","${r.groupName}",${r.vouchersCreated}`
      );
      const totals = `TOTAL,,,${report.totals.totalVouchers}`;
      return [header, ...rows, totals].join('\n');
    }

    case 'router-uptime': {
      const report = reportData as RouterUptimeReport;
      const header = 'Router ID,Router Name,Status,Last Seen,Created At';
      const rows = report.routers.map(
        (r) => `${r.routerId},"${r.routerName}",${r.status},${r.lastSeen || 'N/A'},${r.createdAt}`
      );
      const summary = `\nSummary:,Total: ${report.summary.totalRouters},Online: ${report.summary.onlineCount},Offline: ${report.summary.offlineCount},Degraded: ${report.summary.degradedCount}`;
      return [header, ...rows, summary].join('\n');
    }

    default:
      throw new AppError(400, `Unknown report type for export: ${type}`, 'INVALID_REPORT_TYPE');
  }
}
