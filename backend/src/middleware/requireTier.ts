import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { AppError } from './errorHandler';

/**
 * Middleware factory that gates access to specific subscription tiers.
 * Must be used AFTER requireSubscription (which attaches req.subscription).
 */
export function requireTier(...allowedTiers: string[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    try {
      const subscription = (req as any).subscription;

      if (!subscription) {
        throw new AppError(403, 'Active subscription required', 'SUBSCRIPTION_REQUIRED');
      }

      if (!allowedTiers.includes(subscription.planTier)) {
        throw new AppError(
          403,
          `This feature requires a ${allowedTiers.join(' or ')} plan`,
          'TIER_INSUFFICIENT',
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
