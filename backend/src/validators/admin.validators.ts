import { z } from 'zod';

// Shared pagination
const paginationSchema = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const listUsersQuerySchema = z.object({
  ...paginationSchema,
  search: z.string().max(100).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid('Invalid user ID'),
});

export const updateUserBodySchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  is_active: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const subscriptionIdParamSchema = z.object({
  id: z.string().uuid('Invalid subscription ID'),
});

export const listSubscriptionsQuerySchema = z.object({
  ...paginationSchema,
  status: z.enum(['pending', 'active', 'expired', 'cancelled', 'pending_change']).optional(),
  userId: z.string().uuid().optional(),
});

export const updateSubscriptionBodySchema = z.object({
  status: z.enum(['pending', 'active', 'expired', 'cancelled', 'pending_change']).optional(),
  plan_tier: z.enum(['starter', 'professional', 'enterprise']).optional(),
  end_date: z.string().datetime().optional(),
  voucher_quota: z.coerce.number().int().min(0).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const paymentIdParamSchema = z.object({
  id: z.string().uuid('Invalid payment ID'),
});

export const listPaymentsQuerySchema = z.object({
  ...paginationSchema,
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

export const reviewPaymentBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
});

export const listRoutersQuerySchema = z.object({
  ...paginationSchema,
  status: z.enum(['online', 'offline', 'degraded']).optional(),
  search: z.string().max(100).optional(),
});

export const listAuditLogsQuerySchema = z.object({
  ...paginationSchema,
  adminId: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
  targetEntity: z.string().max(50).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
