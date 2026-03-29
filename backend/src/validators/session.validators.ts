import { z } from 'zod';

export const routerIdParamSchema = z.object({
  id: z.string().uuid('Invalid router ID'),
});

export const sessionIdParamSchema = z.object({
  id: z.string().uuid('Invalid router ID'),
  sid: z.string().min(1, 'Session ID is required'),
});

export const sessionHistoryQuerySchema = z.object({
  username: z.string().max(64, 'Username must be at most 64 characters').optional(),
  page: z.coerce.number().int().min(1, 'Page must be at least 1').default(1),
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit must be at most 100').default(20),
  startDate: z
    .string()
    .datetime({ message: 'Start date must be a valid ISO 8601 datetime' })
    .optional(),
  endDate: z
    .string()
    .datetime({ message: 'End date must be a valid ISO 8601 datetime' })
    .optional(),
  terminateCause: z.string().max(64, 'Terminate cause must be at most 64 characters').optional(),
});
