import { z } from 'zod';

export const requestSubscriptionSchema = z.object({
  planTier: z.string().min(1).max(50),
  durationMonths: z.number().int().min(1).max(12).optional().default(1),
});

export const changeSubscriptionSchema = z.object({
  planTier: z.string().min(1).max(50),
  durationMonths: z.number().int().min(1).max(6).optional().default(1),
});

export const uploadReceiptSchema = z.object({
  paymentId: z.string().uuid('Invalid payment ID'),
  receiptUrl: z.string().url('Invalid receipt URL'),
  referenceCode: z.string().max(100, 'Reference code must be at most 100 characters').optional(),
});
