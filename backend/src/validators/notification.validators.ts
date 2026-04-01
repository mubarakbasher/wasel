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
]);

export const updatePreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        category: notificationCategorySchema,
        enabled: z.boolean(),
      }),
    )
    .min(1, 'At least one preference required'),
});
