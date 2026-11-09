import { z } from 'zod';

export const PRINT_TEMPLATE_IDS = ['classic', 'detailed', 'strips'] as const;

export const MIN_CODE_LENGTH = 6;
export const MAX_CODE_LENGTH = 12;
export const DEFAULT_CODE_LENGTH = 8;

export const printKnobsSchema = z
  .object({
    headerText: z.string().trim().max(60).default(''),
    footerText: z.string().max(120).default(''),
    hotspotAddress: z
      .string()
      .max(100)
      .regex(/^[A-Za-z0-9.\-_/:]*$/, 'Invalid hotspot address')
      .default(''),
    showPrice: z.boolean().default(false),
    showQr: z.boolean().default(false),
    showBatch: z.boolean().default(true),
    stripsPerPage: z.number().int().min(4).max(12).default(8),
  })
  .strict();

export const printSettingsSchema = z
  .object({
    codeLength: z
      .number()
      .int()
      .min(MIN_CODE_LENGTH)
      .max(MAX_CODE_LENGTH)
      .default(DEFAULT_CODE_LENGTH),
    templateId: z.enum(PRINT_TEMPLATE_IDS).default('classic'),
    defaultColumns: z.number().int().min(2).max(9).default(4),
    knobs: printKnobsSchema.default(() => printKnobsSchema.parse({})),
  })
  .strict();

export type PrintSettings = z.infer<typeof printSettingsSchema>;

export const DEFAULT_PRINT_SETTINGS: PrintSettings = printSettingsSchema.parse({});
