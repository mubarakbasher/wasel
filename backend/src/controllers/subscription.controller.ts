import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as subscriptionService from '../services/subscription.service';

export async function getPlans(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const plans = await subscriptionService.getPlans();
    res.status(200).json({
      success: true,
      data: plans,
    });
  } catch (error) {
    next(error);
  }
}

export async function getSubscription(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { subscription, pendingChange } = await subscriptionService.getCurrentSubscription(req.user!.id);
    res.status(200).json({
      success: true,
      data: subscription,
      pendingChange: pendingChange ?? undefined,
    });
  } catch (error) {
    next(error);
  }
}

export async function requestSubscription(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { planTier, durationMonths } = req.body;
    const subscription = await subscriptionService.requestSubscription(req.user!.id, planTier, durationMonths);
    res.status(201).json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
}

export async function changeSubscription(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { planTier, durationMonths } = req.body;
    const result = await subscriptionService.changeSubscription(req.user!.id, planTier, durationMonths);
    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function uploadReceipt(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { paymentId, receiptUrl } = req.body;
    await subscriptionService.uploadReceipt(req.user!.id, paymentId, receiptUrl);
    res.status(200).json({
      success: true,
      data: { message: 'Receipt uploaded successfully' },
    });
  } catch (error) {
    next(error);
  }
}
