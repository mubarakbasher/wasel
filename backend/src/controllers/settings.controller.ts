import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as settingsService from '../services/settings.service';

export async function getBankSettings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await settingsService.getBankInfo();
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function updateBankSettings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { bankName, accountNumber, accountHolder, instructions } = req.body as {
      bankName?: string;
      accountNumber?: string;
      accountHolder?: string;
      instructions?: string;
    };

    const updates: Record<string, unknown> = {};
    if (bankName !== undefined) updates['bank.name'] = bankName;
    if (accountNumber !== undefined) updates['bank.accountNumber'] = accountNumber;
    if (accountHolder !== undefined) updates['bank.accountHolder'] = accountHolder;
    if (instructions !== undefined) updates['bank.instructions'] = instructions;

    await settingsService.updateSettings(updates, req.user!.id);
    const data = await settingsService.getBankInfo();
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/**
 * User-facing bank info — the 4 bank.* fields are considered non-secret,
 * so we return them verbatim to any authenticated user.
 */
export async function getPublicBankInfo(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await settingsService.getBankInfo();
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}
