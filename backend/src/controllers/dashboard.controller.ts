import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as dashboardService from '../services/dashboard.service';

export async function getDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await dashboardService.getDashboardData(req.user!.id);
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}
