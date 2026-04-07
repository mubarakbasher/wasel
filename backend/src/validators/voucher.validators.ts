import { z } from 'zod';

export const routerIdParamSchema = z.object({
  id: z.string().uuid('Invalid router ID'),
});

export const voucherIdParamSchema = z.object({
  id: z.string().uuid('Invalid router ID'),
  vid: z.string().uuid('Invalid voucher ID'),
});

export const createVouchersSchema = z.object({
  limitType: z.enum(['time', 'data'], {
    error: 'Limit type must be "time" or "data"',
  }),
  limitValue: z
    .number()
    .positive('Limit value must be positive'),
  limitUnit: z.enum(['minutes', 'hours', 'days', 'MB', 'GB'], {
    error: 'Invalid limit unit',
  }),
  validitySeconds: z
    .number()
    .int()
    .min(0, 'Validity must be non-negative')
    .optional()
    .nullable(),
  count: z
    .number()
    .int()
    .min(1, 'Count must be at least 1'),
  price: z
    .number()
    .min(0, 'Price must be non-negative'),
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
  status: z.enum(['unused', 'active', 'used', 'expired', 'disabled']).optional(),
  limitType: z.enum(['time', 'data']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(64).optional(),
});
