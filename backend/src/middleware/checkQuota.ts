import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { checkVoucherQuota } from '../services/subscription.service';
import { AppError } from './errorHandler';

/// Check if user has enough voucher quota for `count` vouchers.
/// Usage: checkQuota(1) for single, or read count from req.body for bulk.
export function checkQuota(getCount?: (req: AuthenticatedRequest) => number) {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const count = getCount ? getCount(req) : 1;

      const hasQuota = await checkVoucherQuota(userId, count);
      if (!hasQuota) {
        throw new AppError(403, 'Voucher quota exceeded. Upgrade your plan for more vouchers.', 'QUOTA_EXCEEDED');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
