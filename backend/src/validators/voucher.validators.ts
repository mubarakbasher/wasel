import { z } from 'zod';

export const routerIdParamSchema = z.object({
  id: z.string().uuid('Invalid router ID'),
});

export const voucherIdParamSchema = z.object({
  id: z.string().uuid('Invalid router ID'),
  vid: z.string().uuid('Invalid voucher ID'),
});

export const createVoucherSchema = z.object({
  profileId: z.string().uuid('Invalid profile ID'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(64, 'Username must be at most 64 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username must contain only letters, numbers, hyphens, and underscores')
    .optional(),
  password: z
    .string()
    .min(4, 'Password must be at least 4 characters')
    .max(64, 'Password must be at most 64 characters')
    .optional(),
  comment: z.string().max(255, 'Comment must be at most 255 characters').optional(),
  expiration: z
    .string()
    .datetime({ message: 'Expiration must be a valid ISO 8601 datetime' })
    .optional(),
  simultaneousUse: z
    .number()
    .int()
    .min(1, 'Simultaneous use must be at least 1')
    .max(10, 'Simultaneous use must be at most 10')
    .optional(),
});

export const bulkCreateVoucherSchema = z.object({
  profileId: z.string().uuid('Invalid profile ID'),
  count: z
    .number()
    .int()
    .min(1, 'Count must be at least 1')
    .max(100, 'Count must be at most 100'),
  usernamePrefix: z
    .string()
    .min(1, 'Username prefix is required')
    .max(50, 'Username prefix must be at most 50 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Prefix must contain only letters, numbers, hyphens, and underscores')
    .optional(),
  usernameLength: z
    .number()
    .int()
    .min(4, 'Username length must be at least 4')
    .max(16, 'Username length must be at most 16')
    .optional(),
  passwordLength: z
    .number()
    .int()
    .min(4, 'Password length must be at least 4')
    .max(16, 'Password length must be at most 16')
    .optional(),
  comment: z.string().max(255, 'Comment must be at most 255 characters').optional(),
  expiration: z
    .string()
    .datetime({ message: 'Expiration must be a valid ISO 8601 datetime' })
    .optional(),
  simultaneousUse: z
    .number()
    .int()
    .min(1, 'Simultaneous use must be at least 1')
    .max(10, 'Simultaneous use must be at most 10')
    .optional(),
});

export const updateVoucherSchema = z.object({
  status: z.enum(['active', 'disabled'], {
    error: 'Status must be "active" or "disabled"',
  }).optional(),
  expiration: z
    .string()
    .datetime({ message: 'Expiration must be a valid ISO 8601 datetime' })
    .optional()
    .nullable(),
  comment: z.string().max(255, 'Comment must be at most 255 characters').optional(),
}).refine(
  (data) => Object.values(data).some((value) => value !== undefined),
  { message: 'At least one field must be provided' },
);

export const listVouchersQuerySchema = z.object({
  status: z.enum(['active', 'disabled', 'expired', 'used']).optional(),
  profileId: z.string().uuid('Invalid profile ID').optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(64).optional(),
});
