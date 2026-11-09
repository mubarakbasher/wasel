import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as printSettingsService from '../services/printSettings.service';

export async function getSettings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const settings = await printSettingsService.getPrintSettings(req.user!.id);
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
}

export async function updateSettings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const settings = await printSettingsService.upsertPrintSettings(req.user!.id, req.body);
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
}
