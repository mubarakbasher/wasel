import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import * as reportService from '../services/report.service';

/**
 * GET /reports
 *
 * Generate a report and return as JSON.
 * Requires Professional or Enterprise subscription.
 */
export async function getReport(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;

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
