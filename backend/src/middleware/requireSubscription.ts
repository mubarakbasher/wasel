import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { getActiveSubscription } from '../services/subscription.service';
import { AppError } from './errorHandler';

/// Requires an active subscription. Attaches subscription info to req.
export async function requireSubscription(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const subscription = await getActiveSubscription(userId);

    if (!subscription) {
      throw new AppError(403, 'Active subscription required', 'SUBSCRIPTION_REQUIRED');
    }

    if (subscription.status === 'expired') {
      // 7-day read-only grace period — allow GET requests only
      if (req.method !== 'GET') {
        throw new AppError(403, 'Subscription expired. Renew to continue.', 'SUBSCRIPTION_EXPIRED');
      }
    }

    // Attach to request for downstream use
    (req as any).subscription = subscription;
    next();
  } catch (error) {
    next(error);
  }
}
