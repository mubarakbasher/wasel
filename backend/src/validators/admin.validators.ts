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

export const routerIdParamSchema = z.object({
  id: z.string().uuid('Invalid router ID'),
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
  plan_tier: z.string().min(1).max(50).optional(),
  end_date: z.string().datetime().optional(),
  voucher_quota: z.coerce.number().int().min(-1).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const paymentIdParamSchema = z.object({
  id: z.string().uuid('Invalid payment ID'),
});

export const listPaymentsQuerySchema = z.object({
  ...paginationSchema,
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

export const reviewPaymentBodySchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    rejection_reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine(
    (data) => data.decision !== 'rejected' || (data.rejection_reason && data.rejection_reason.length > 0),
    { message: 'rejection_reason is required when decision is rejected', path: ['rejection_reason'] },
  );

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

// Plans
export const planIdParamSchema = z.object({
  id: z.string().uuid('Invalid plan ID'),
});

export const createPlanBodySchema = z.object({
  tier: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, 'Tier must be lowercase alphanumeric with underscores'),
  name: z.string().min(1).max(100),
  price: z.coerce.number().min(0),
  currency: z.string().length(3).default('USD'),
  max_routers: z.coerce.number().int().min(1),
  monthly_vouchers: z.coerce.number().int().min(-1),
  session_monitoring: z.string().max(100).optional(),
  dashboard: z.string().max(100).optional(),
  features: z.array(z.string()).default([]),
  allowed_durations: z.array(z.coerce.number().int().min(1).max(12)).min(1).default([1]),
  is_active: z.boolean().default(true),
});

export const createRouterForUserBodySchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name must be at most 100 characters'),
  model: z.string().max(100, 'Model must be at most 100 characters').optional(),
  rosVersion: z.string().max(20, 'ROS version must be at most 20 characters').optional(),
  apiUser: z.string().max(100, 'API user must be at most 100 characters').optional(),
  apiPass: z.string().max(255, 'API password must be at most 255 characters').optional(),
  overrideQuota: z.boolean().optional(),
});

export const updatePlanBodySchema = z.object({
  tier: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, 'Tier must be lowercase alphanumeric with underscores').optional(),
  name: z.string().min(1).max(100).optional(),
  price: z.coerce.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  max_routers: z.coerce.number().int().min(1).optional(),
  monthly_vouchers: z.coerce.number().int().min(-1).optional(),
  session_monitoring: z.string().max(100).optional(),
  dashboard: z.string().max(100).optional(),
  features: z.array(z.string()).optional(),
  allowed_durations: z.array(z.coerce.number().int().min(1).max(12)).min(1).optional(),
  is_active: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });
