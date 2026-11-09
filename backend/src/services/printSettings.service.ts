import { pool } from '../config/database';
import logger from '../config/logger';
import {
  PrintSettings,
  DEFAULT_PRINT_SETTINGS,
  DEFAULT_CODE_LENGTH,
  printSettingsSchema,
} from '../validators/printSettings.validators';

/**
 * Map a database row (snake_case) to a PrintSettings document.
 * Unknown/drifted fields are excluded; missing fields fall back to defaults
 * via printSettingsSchema.safeParse so old rows gain new knobs automatically.
 */
function rowToSettings(row: {
  code_length: number;
  template_id: string;
  default_columns: number;
  knobs: unknown;
}): PrintSettings {
  const raw = {
    codeLength: row.code_length,
    templateId: row.template_id,
    defaultColumns: row.default_columns,
    knobs: row.knobs ?? {},
  };

  const result = printSettingsSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }

  // Row has drifted (e.g. old templateId value not in new enum). Log and fall back
  // to defaults so the app never sees an invalid document.
  logger.warn('printSettings row failed schema validation, falling back to defaults', {
    errors: result.error.issues,
  });

  // Try per-field recovery: use the raw value when valid, default otherwise.
  const fallback = { ...DEFAULT_PRINT_SETTINGS };
  const codeLengthResult = printSettingsSchema.shape.codeLength.safeParse(raw.codeLength);
  if (codeLengthResult.success) fallback.codeLength = codeLengthResult.data;

  const templateResult = printSettingsSchema.shape.templateId.safeParse(raw.templateId);
  if (templateResult.success) fallback.templateId = templateResult.data;

  const columnsResult = printSettingsSchema.shape.defaultColumns.safeParse(raw.defaultColumns);
  if (columnsResult.success) fallback.defaultColumns = columnsResult.data;

  return fallback;
}

/**
 * Retrieve print settings for the given user.
 * Returns DEFAULT_PRINT_SETTINGS when no row exists.
 */
export async function getPrintSettings(userId: string): Promise<PrintSettings> {
  try {
    const result = await pool.query<{
      code_length: number;
      template_id: string;
      default_columns: number;
      knobs: unknown;
    }>(
      `SELECT code_length, template_id, default_columns, knobs
         FROM user_print_settings
        WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return DEFAULT_PRINT_SETTINGS;
    }

    return rowToSettings(result.rows[0]);
  } catch (error) {
    logger.error('Failed to get print settings', { error, userId });
    throw error;
  }
}

/**
 * Upsert print settings for the given user.
 * Full-document replace on conflict.
 */
export async function upsertPrintSettings(
  userId: string,
  input: PrintSettings,
): Promise<PrintSettings> {
  try {
    const result = await pool.query<{
      code_length: number;
      template_id: string;
      default_columns: number;
      knobs: unknown;
    }>(
      `INSERT INTO user_print_settings (user_id, code_length, template_id, default_columns, knobs)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
               SET code_length     = EXCLUDED.code_length,
                   template_id     = EXCLUDED.template_id,
                   default_columns = EXCLUDED.default_columns,
                   knobs           = EXCLUDED.knobs,
                   updated_at      = NOW()
         RETURNING code_length, template_id, default_columns, knobs`,
      [userId, input.codeLength, input.templateId, input.defaultColumns, input.knobs],
    );

    logger.info('Print settings upserted', { userId });
    return rowToSettings(result.rows[0]);
  } catch (error) {
    logger.error('Failed to upsert print settings', { error, userId });
    throw error;
  }
}

/**
 * Retrieve only the code length for voucher generation.
 * Returns DEFAULT_CODE_LENGTH when no row exists.
 * Kept lightweight — this is on the voucher-creation hot path.
 */
export async function getCodeLength(userId: string): Promise<number> {
  try {
    const result = await pool.query<{ code_length: number }>(
      `SELECT code_length FROM user_print_settings WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return DEFAULT_CODE_LENGTH;
    }

    return result.rows[0].code_length;
  } catch (error) {
    logger.error('Failed to get code length', { error, userId });
    throw error;
  }
}
