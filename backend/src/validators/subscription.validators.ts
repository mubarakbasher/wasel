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
});
