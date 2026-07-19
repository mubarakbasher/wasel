import { z } from 'zod';

export const registerDeviceTokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  platform: z.enum(['android', 'ios'], { message: 'Platform must be android or ios' }),
});

export const unregisterDeviceTokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

const notificationCategorySchema = z.enum([
  'subscription_expiring',
  'subscription_expired',
  'payment_confirmed',
  'router_offline',
  'router_online',
  'voucher_quota_low',
  'bulk_creation_complete',
  'support_reply',
]);

// Cap the preferences array at the number of distinct categories that actually
// exist (derived from the enum so it stays correct if categories are added or
// removed). A legitimate update carries at most one entry per category, so this
// bound closes the connection-exhaustion DoS where an authenticated caller PUTs
// tens of thousands of (duplicate-allowed) entries and forces one serialized
// INSERT round-trip each inside a single held transaction.
export const MAX_NOTIFICATION_PREFERENCES = notificationCategorySchema.options.length;

export const updatePreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        category: notificationCategorySchema,
        enabled: z.boolean(),
      }),
    )
    .min(1, 'At least one preference required')
    .max(
      MAX_NOTIFICATION_PREFERENCES,
      `At most ${MAX_NOTIFICATION_PREFERENCES} preferences allowed`,
    ),
});

export const listInboxQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Opaque keyset cursor from a previous response `meta.nextCursor`. */
  cursor: z.string().max(512).optional(),
});

export const notificationIdParamSchema = z.object({
  id: z.string().uuid('Invalid notification ID'),
});
