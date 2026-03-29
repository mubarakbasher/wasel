import { z } from 'zod';

// Mikrotik-Rate-Limit format: "uploadM/downloadM" or more complex variants
// Examples: "2M/5M", "1M/2M", "512K/1M", "10M/10M 20M/20M 0 0 8"
const mikrotikRateLimitRegex = /^\d+[KkMmGg]?\/\d+[KkMmGg]?/;

export const createProfileSchema = z.object({
  groupName: z
    .string()
    .min(1, 'Group name is required')
    .max(64, 'Group name must be at most 64 characters')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Group name must contain only letters, numbers, hyphens, and underscores'
    ),
  displayName: z
    .string()
    .min(1, 'Display name is required')
    .max(100, 'Display name must be at most 100 characters'),
  bandwidthUp: z
    .string()
    .max(20)
    .optional(),
  bandwidthDown: z
    .string()
    .max(20)
    .optional(),
  sessionTimeout: z
    .number()
    .int()
    .min(0, 'Session timeout must be non-negative')
    .optional(),
  totalTime: z
    .number()
    .int()
    .min(0, 'Total time must be non-negative')
    .optional(),
  totalData: z
    .number()
    .int()
    .min(0, 'Total data must be non-negative')
    .optional(),
}).refine(
  (data) => {
    if (data.bandwidthUp && data.bandwidthDown) {
      const rateLimit = `${data.bandwidthUp}/${data.bandwidthDown}`;
      return mikrotikRateLimitRegex.test(rateLimit);
    }
    return true;
  },
  { message: 'Invalid bandwidth format. Use format like "2M", "512K", "10M"', path: ['bandwidthUp'] }
);

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .min(1, 'Display name is required')
    .max(100, 'Display name must be at most 100 characters')
    .optional(),
  bandwidthUp: z
    .string()
    .max(20)
    .optional(),
  bandwidthDown: z
    .string()
    .max(20)
    .optional(),
  sessionTimeout: z
    .number()
    .int()
    .min(0, 'Session timeout must be non-negative')
    .optional()
    .nullable(),
  totalTime: z
    .number()
    .int()
    .min(0, 'Total time must be non-negative')
    .optional()
    .nullable(),
  totalData: z
    .number()
    .int()
    .min(0, 'Total data must be non-negative')
    .optional()
    .nullable(),
}).refine(
  (data) => Object.values(data).some((value) => value !== undefined),
  { message: 'At least one field must be provided' }
);

export const profileIdParamSchema = z.object({
  pid: z.string().uuid('Invalid profile ID'),
});
