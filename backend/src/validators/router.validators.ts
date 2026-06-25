import { z } from 'zod';
import { HOTSPOT_TEMPLATES } from '../hotspot-templates/manifest';

export const createRouterSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100, 'Name must be at most 100 characters'),
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

export const healthQuerySchema = z.object({
  refresh: z.enum(['true', 'false']).optional(),
});

// Build the allowed template id enum from the manifest at parse time so it stays
// in sync with the template bundles without any hardcoding.
const templateIds = HOTSPOT_TEMPLATES.map((t) => t.id) as [string, ...string[]];

export const setHotspotTemplateSchema = z.object({
  templateId: z.enum(templateIds, {
    message: `templateId must be one of: ${templateIds.join(', ')}`,
  }),
});

