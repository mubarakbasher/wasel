import { z } from 'zod';

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const updateBankSettingsSchema = z.object({
  bankName: z.string().max(120).optional(),
  accountNumber: z.string().max(64).optional(),
  accountHolder: z.string().max(120).optional(),
  instructions: z.string().max(1000).optional(),
});

export const createAdminSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters'),
  email: z.string().email('Invalid email address'),
  password: passwordSchema,
});

export const resetAdminPasswordSchema = z.object({
  password: passwordSchema,
});

export const adminIdParamSchema = z.object({
  id: z.string().uuid('Invalid admin ID'),
});

export const setAdminActiveBodySchema = z.object({
  is_active: z.boolean(),
});
