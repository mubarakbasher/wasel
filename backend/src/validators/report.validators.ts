import { z } from 'zod';

export const reportQuerySchema = z.object({
  type: z.enum(['voucher-sales', 'sessions', 'revenue', 'router-uptime']),
  startDate: z.string().datetime({ message: 'Start date must be a valid ISO 8601 datetime' }),
  endDate: z.string().datetime({ message: 'End date must be a valid ISO 8601 datetime' }),
  routerId: z.string().uuid('Invalid router ID').optional(),
});

export const exportQuerySchema = z.object({
  type: z.enum(['voucher-sales', 'sessions', 'revenue', 'router-uptime']),
  startDate: z.string().datetime({ message: 'Start date must be a valid ISO 8601 datetime' }),
  endDate: z.string().datetime({ message: 'End date must be a valid ISO 8601 datetime' }),
  routerId: z.string().uuid('Invalid router ID').optional(),
  format: z.enum(['csv', 'pdf']).default('csv'),
});
