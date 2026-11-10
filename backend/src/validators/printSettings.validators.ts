import { z } from 'zod';

export const PRINT_TEMPLATE_IDS = ['classic', 'detailed', 'strips'] as const;

export const MIN_CODE_LENGTH = 6;
export const MAX_CODE_LENGTH = 12;
export const DEFAULT_CODE_LENGTH = 8;

const SAFE_TEXT_RE = /^[^\p{C}‪-‮⁦-⁩]*$/u;

export const printKnobsSchema = z
  .object({
    headerText: z
      .string()
      .trim()
      .max(60)
      .regex(SAFE_TEXT_RE, 'Invalid characters')
      .default(''),
    footerText: z
      .string()
      .trim()
      .max(120)
      .regex(SAFE_TEXT_RE, 'Invalid characters')
      .default(''),
    hotspotAddress: z
      .string()
      .trim()
      .max(100)
      .regex(
        /^$|^(?=.{1,100}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*(:\d{1,5})?(\/[A-Za-z0-9._~\-\/]*)?$/,
        'Invalid hotspot address',
      )
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
