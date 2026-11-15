import { z } from 'zod';

const PERIOD_PRESETS = ['month', '30d', '3m', '12m'] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const analyticsPeriodQuerySchema = z
  .object({
    period: z.enum(PERIOD_PRESETS).optional(),
    from: z.string().regex(DATE_PATTERN, 'must be YYYY-MM-DD').optional(),
    to: z.string().regex(DATE_PATTERN, 'must be YYYY-MM-DD').optional(),
  })
  .refine(
    (d) => {
      const hasFrom = d.from !== undefined;
      const hasTo = d.to !== undefined;
      return hasFrom === hasTo; // both or neither
    },
    { message: 'Provide both from and to, or neither' },
  );

export const analyticsExportQuerySchema = analyticsPeriodQuerySchema.and(
  z.object({
    q: z.string().max(100).optional(),
    filter: z.string().optional(),
    sort: z.string().optional(),
    dir: z.enum(['asc', 'desc']).optional(),
  }),
);

export const analyticsOperatorParamSchema = z.object({
  id: z.string().uuid('Invalid operator ID'),
});
