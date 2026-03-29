import { z } from 'zod';

export const createRouterSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name must be at most 100 characters'),
  model: z.string().max(100, 'Model must be at most 100 characters').optional(),
  rosVersion: z.string().max(20, 'ROS version must be at most 20 characters').optional(),
  apiUser: z.string().max(100, 'API user must be at most 100 characters').optional(),
  apiPass: z.string().max(255, 'API password must be at most 255 characters').optional(),
});

export const updateRouterSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name must be at most 100 characters').optional(),
  model: z.string().max(100, 'Model must be at most 100 characters').optional(),
  rosVersion: z.string().max(20, 'ROS version must be at most 20 characters').optional(),
  apiUser: z.string().max(100, 'API user must be at most 100 characters').optional(),
  apiPass: z.string().max(255, 'API password must be at most 255 characters').optional(),
}).refine(
  (data) => Object.values(data).some((value) => value !== undefined),
  { message: 'At least one field must be provided' }
);

export const routerIdParamSchema = z.object({
  id: z.string().uuid('Invalid router ID'),
});
