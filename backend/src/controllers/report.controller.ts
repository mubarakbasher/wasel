import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { pool } from '../config/database';
import * as reportService from '../services/report.service';

/**
 * Check that the user has a Professional or Enterprise subscription.
 * Reports are not available for Starter tier.
 */
async function requireReportAccess(userId: string): Promise<void> {
  const result = await pool.query(
    `SELECT plan_tier, status FROM subscriptions
     WHERE user_id = $1 AND status IN ('active', 'expired')
     ORDER BY end_date DESC LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new AppError(403, 'Active subscription required to access reports', 'SUBSCRIPTION_REQUIRED');
  }

  const { plan_tier, status } = result.rows[0];

  if (status !== 'active') {
    throw new AppError(403, 'Active subscription required to access reports', 'SUBSCRIPTION_INACTIVE');
  }

  if (plan_tier === 'starter') {
    throw new AppError(403, 'Reports are available for Professional and Enterprise plans only', 'TIER_INSUFFICIENT');
  }
}

/**
 * GET /reports
 *
 * Generate a report and return as JSON.
 * Requires Professional or Enterprise subscription.
 */
export async function getReport(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    await requireReportAccess(userId);

    const { type, startDate, endDate, routerId } = req.query as {
      type: reportService.ReportType;
      startDate: string;
      endDate: string;
      routerId?: string;
    };

    const reportData = await reportService.generateReport(userId, type, startDate, endDate, routerId);

    res.status(200).json({
      success: true,
      data: reportData,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /reports/export
 *
 * Generate a report and return as a downloadable file.
 * Supports CSV format. PDF is a placeholder for Phase 2.
 * Requires Professional or Enterprise subscription.
 */
export async function exportReport(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    await requireReportAccess(userId);

    const { type, startDate, endDate, routerId, format } = req.query as {
      type: reportService.ReportType;
      startDate: string;
      endDate: string;
      routerId?: string;
      format: 'csv' | 'pdf';
    };

    if (format === 'pdf') {
      throw new AppError(501, 'PDF export is not yet available. Please use CSV format.', 'PDF_NOT_IMPLEMENTED');
    }

    const reportData = await reportService.generateReport(userId, type, startDate, endDate, routerId);
    const csvContent = reportService.exportReportCsv(reportData, type);

    const filename = `${type}-report-${startDate.split('T')[0]}-to-${endDate.split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (error) {
    next(error);
  }
}
