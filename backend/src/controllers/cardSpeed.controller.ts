import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as cardSettingsService from '../services/cardSettings.service';

export async function getCardSpeed(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const setting = await cardSettingsService.getCardSpeedSetting(req.user!.id);
    res.status(200).json({ success: true, data: setting });
  } catch (error) {
    next(error);
  }
}

export async function updateCardSpeed(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const setting = await cardSettingsService.upsertCardSpeedSetting(req.user!.id, req.body);
    res.status(200).json({ success: true, data: setting });
  } catch (error) {
    next(error);
  }
}
