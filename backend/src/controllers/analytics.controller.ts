import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { resolvePeriod } from '../services/analyticsPeriod';
import {
  getMoneyAnalytics,
  getOperatorsAnalytics,
  getOperatorAnalytics,
  getNetworkAnalytics,
} from '../services/analytics.service';
import { applyTableQuery } from '../services/analyticsTable';
import * as auditService from '../services/audit.service';
import { sendCsv } from './admin.controller';
import { toCsv } from '../utils/csv';
import { config } from '../config';
import type { ResolvedPeriod } from '../services/analytics.types';
import type { OperatorRow, RouterRow, RenewalDueRow, LostOperatorRow } from '../services/analytics.types';

const EXPORT_ROW_CAP = 10_000;

function clientIp(req: AuthenticatedRequest): string {
  return Array.isArray(req.ip) ? req.ip[0] : req.ip || '';
}

function resolvePeriodFromQuery(
  query: Record<string, string | undefined>,
  tab: 'money' | 'operators' | 'network',
): ResolvedPeriod {
  return resolvePeriod(
    { period: query.period as never, from: query.from, to: query.to },
    tab,
    new Date(),
    config.ANALYTICS_TZ,
  );
}

export async function getMoney(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const p = resolvePeriodFromQuery(req.query as Record<string, string>, 'money');
    const { data, meta } = await getMoneyAnalytics(p);
    res.status(200).json({ success: true, data, meta });
  } catch (e) {
    next(e);
  }
}

export async function getOperators(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const p = resolvePeriodFromQuery(req.query as Record<string, string>, 'operators');
    const { data, meta } = await getOperatorsAnalytics(p);
    res.status(200).json({ success: true, data, meta });
  } catch (e) {
    next(e);
  }
}

export async function getOperator(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.params.id as string;
    const p = resolvePeriodFromQuery(req.query as Record<string, string>, 'operators');
    const { data, meta } = await getOperatorAnalytics(userId, p);
    res.status(200).json({ success: true, data, meta });
  } catch (e) {
    next(e);
  }
}

export async function getNetwork(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const p = resolvePeriodFromQuery(req.query as Record<string, string>, 'network');
    const { data, meta } = await getNetworkAnalytics(p);
    res.status(200).json({ success: true, data, meta });
  } catch (e) {
    next(e);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export async function exportRenewalsDue(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as Record<string, string>;
    const p = resolvePeriodFromQuery(q, 'money');
    const { data } = await getMoneyAnalytics(p);
    let rows = data.renewalsDue.slice(0, EXPORT_ROW_CAP);
    rows = applyTableQuery<RenewalDueRow>(rows, q, {
      search: (r) => [r.operator, r.email ?? ''],
      filters: {},
      sorts: {
        operator: (r) => r.operator,
        endsAt: (r) => r.endsAt,
        amount: (r) => r.amount,
      },
    });
    const csv = toCsv(rows, [
      { header: 'Operator', value: (r) => r.operator },
      { header: 'Email', value: (r) => r.email },
      { header: 'Plan', value: (r) => r.planName },
      { header: 'Ends', value: (r) => r.endsAt },
      { header: 'Amount', value: (r) => r.amount },
      { header: 'Estimated', value: (r) => r.estimated },
      { header: 'Granted', value: (r) => r.granted },
      { header: 'Paid Before', value: (r) => r.paidBefore },
    ]);
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'analytics.renewals_due.export_csv',
      targetEntity: 'analytics',
      targetId: 'renewals-due',
      ipAddress: clientIp(req),
    });
    sendCsv(res, 'analytics-renewals-due', csv);
  } catch (e) {
    next(e);
  }
}

export async function exportLost(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as Record<string, string>;
    const p = resolvePeriodFromQuery(q, 'money');
    const { data } = await getMoneyAnalytics(p);
    let rows = data.lost.slice(0, EXPORT_ROW_CAP);
    rows = applyTableQuery<LostOperatorRow>(rows, q, {
      search: (r) => [r.operator, r.email ?? ''],
      filters: {},
      sorts: {
        operator: (r) => r.operator,
        endedAt: (r) => r.endedAt,
        monthsPaid: (r) => r.monthsPaid,
        totalPaid: (r) => r.totalPaid,
      },
    });
    const csv = toCsv(rows, [
      { header: 'Operator', value: (r) => r.operator },
      { header: 'Email', value: (r) => r.email },
      { header: 'Deleted', value: (r) => r.deleted },
      { header: 'Plan', value: (r) => r.planName },
      { header: 'Ended', value: (r) => r.endedAt },
      { header: 'Months Paid', value: (r) => r.monthsPaid },
      { header: 'Total Paid', value: (r) => r.totalPaid },
    ]);
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'analytics.lost_operators.export_csv',
      targetEntity: 'analytics',
      targetId: 'lost',
      ipAddress: clientIp(req),
    });
    sendCsv(res, 'analytics-lost', csv);
  } catch (e) {
    next(e);
  }
}

export async function exportOperators(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as Record<string, string>;
    const p = resolvePeriodFromQuery(q, 'operators');
    const { data } = await getOperatorsAnalytics(p);
    let rows = data.rows.slice(0, EXPORT_ROW_CAP);
    rows = applyTableQuery<OperatorRow>(rows, q, {
      search: (r) => [r.operator, r.email],
      filters: {
        quiet: (r) => r.flags.isQuiet,
        'near-limit': (r) => r.flags.nearLimit,
        'not-started': (r) => r.flags.notStarted,
      },
      sorts: {
        operator: (r) => r.operator,
        plan: (r) => r.planName,
        daysLeft: (r) => r.daysLeft,
        routersOnline: (r) => r.routersOnline,
        cardsCreated: (r) => r.cardsCreated,
        cardsUsed: (r) => r.cardsUsed,
        salesValue: (r) => r.salesValue,
        changePct: (r) => r.changePct,
        lastActiveAt: (r) => r.lastActiveAt,
      },
    });
    const csv = toCsv(rows, [
      { header: 'Operator', value: (r) => r.operator },
      { header: 'Email', value: (r) => r.email },
      { header: 'Plan', value: (r) => r.planName },
      { header: 'Days Left', value: (r) => r.daysLeft },
      { header: 'Routers Online', value: (r) => r.routersOnline },
      { header: 'Routers Total', value: (r) => r.routersTotal },
      { header: 'Cards Created', value: (r) => r.cardsCreated },
      { header: 'Cards Used', value: (r) => r.cardsUsed },
      { header: 'Sales Value', value: (r) => r.salesValue },
      { header: 'Change %', value: (r) => r.changePct },
      { header: 'Last Active', value: (r) => r.lastActiveAt },
      { header: 'Going Quiet', value: (r) => r.flags.isQuiet },
      { header: 'Near Limit', value: (r) => r.flags.nearLimit },
      { header: 'Not Started', value: (r) => r.flags.notStarted },
    ]);
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'analytics.operators.export_csv',
      targetEntity: 'analytics',
      targetId: 'operators',
      ipAddress: clientIp(req),
    });
    sendCsv(res, 'analytics-operators', csv);
  } catch (e) {
    next(e);
  }
}

export async function exportRouters(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as Record<string, string>;
    const p = resolvePeriodFromQuery(q, 'network');
    const { data } = await getNetworkAnalytics(p);
    let rows = data.routers.slice(0, EXPORT_ROW_CAP);
    rows = applyTableQuery<RouterRow>(rows, q, {
      search: (r) => [r.router, r.operator],
      filters: {
        dropping: (r) => r.flags.dropping,
        offline: (r) => r.flags.offlineNow,
      },
      sorts: {
        router: (r) => r.router,
        operator: (r) => r.operator,
        uptimePct: (r) => r.uptimePct,
        drops: (r) => r.drops,
        longestOutageSec: (r) => r.longestOutageSec,
        sessions: (r) => r.sessions,
        dataBytes: (r) => r.dataBytes,
        status: (r) => r.status,
      },
    });
    const csv = toCsv(rows, [
      { header: 'Router', value: (r) => r.router },
      { header: 'Operator', value: (r) => r.operator },
      { header: 'Uptime %', value: (r) => r.uptimePct },
      { header: 'Drops', value: (r) => r.drops },
      { header: 'Longest Outage (s)', value: (r) => r.longestOutageSec },
      { header: 'Sessions', value: (r) => r.sessions },
      { header: 'Data (bytes)', value: (r) => r.dataBytes },
      { header: 'Status', value: (r) => r.status },
    ]);
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'analytics.routers.export_csv',
      targetEntity: 'analytics',
      targetId: 'routers',
      ipAddress: clientIp(req),
    });
    sendCsv(res, 'analytics-routers', csv);
  } catch (e) {
    next(e);
  }
}
