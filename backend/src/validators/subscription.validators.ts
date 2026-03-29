import { z } from 'zod';

export const requestSubscriptionSchema = z.object({
  planTier: z.enum(['starter']), // MVP: starter only
});

export const uploadReceiptSchema = z.object({
  paymentId: z.string().uuid('Invalid payment ID'),
  receiptUrl: z.string().url('Invalid receipt URL'),
  referenceCode: z.string().max(100, 'Reference code must be at most 100 characters').optional(),
});
