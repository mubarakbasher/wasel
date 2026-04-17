import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { RECEIPTS_PUBLIC_PREFIX } from '../middleware/upload';
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
    const { paymentId } = req.body;
    const file = (req as AuthenticatedRequest & { file?: Express.Multer.File }).file;
    if (!file) {
      throw new AppError(400, 'Receipt image is required', 'RECEIPT_FILE_REQUIRED');
    }
    const receiptUrl = `${RECEIPTS_PUBLIC_PREFIX}/${file.filename}`;
    await subscriptionService.uploadReceipt(req.user!.id, paymentId, receiptUrl);
    res.status(200).json({
      success: true,
      data: { message: 'Receipt uploaded successfully', receiptUrl },
    });
  } catch (error) {
    next(error);
  }
}

export async function getUserPayments(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const payments = await subscriptionService.getUserPayments(req.user!.id);
    res.status(200).json({
      success: true,
      data: payments,
    });
  } catch (error) {
    next(error);
  }
}

export async function cancelPayment(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const paymentId = req.params.id as string;
    await subscriptionService.cancelPayment(req.user!.id, paymentId);
    res.status(200).json({ success: true, data: { message: 'Payment cancelled' } });
  } catch (error) {
    next(error);
  }
}
