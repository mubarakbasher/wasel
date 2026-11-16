import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import {
  SPEED_LIMIT_OPTIONS,
  DEFAULT_SPEED_LIMIT,
  CardSpeedUpdate,
  CardSpeedSetting,
} from '../validators/cardSpeed.validators';
import { SPEED_VALUE_RE } from '../utils/radius';
import { DEFAULT_CODE_LENGTH } from '../validators/printSettings.validators';

export const CARD_SPEED_UPSERT_SQL =
  `INSERT INTO user_print_settings (user_id, speed_limit_enabled, speed_limit)
        VALUES ($1, $2, $3)
   ON CONFLICT (user_id) DO UPDATE
           SET speed_limit_enabled = EXCLUDED.speed_limit_enabled,
               speed_limit         = EXCLUDED.speed_limit,
               updated_at          = NOW()
     RETURNING speed_limit_enabled, speed_limit`;

function rowToCardSpeedSetting(row: {
  speed_limit_enabled: boolean;
  speed_limit: string;
}): CardSpeedSetting {
  return {
    enabled: row.speed_limit_enabled,
    speed: row.speed_limit,
    options: SPEED_LIMIT_OPTIONS,
  };
}

export interface CardCreationSettings {
  codeLength: number;
  speedLimit: string | null;
}

export const CARD_CREATION_SETTINGS_SQL =
  `SELECT code_length, speed_limit_enabled, speed_limit
     FROM user_print_settings
    WHERE user_id = $1`;

/**
 * Retrieve card-creation settings (code length + speed limit) for a user.
 * Returns defaults when no row exists.
 *
 * This deliberately replaces the 2026-11-10 fail-open getCodeLength: a silently
 * unlimited batch cannot be repaired. Any DB error or malformed stored speed
 * throws 503 CARD_SETTINGS_UNAVAILABLE so the operator sees a clear transient
 * error rather than creating cards with the wrong speed.
 */
export async function getCardCreationSettings(userId: string): Promise<CardCreationSettings> {
  let result: { rows: Array<{ code_length?: number; speed_limit_enabled?: boolean; speed_limit?: string }> };
  try {
    result = await pool.query<{ code_length: number; speed_limit_enabled: boolean; speed_limit: string }>(
      CARD_CREATION_SETTINGS_SQL,
      [userId],
    );
  } catch (error) {
    logger.error('Failed to get card creation settings', { error, userId });
    throw new AppError(503, 'Card settings are temporarily unavailable. Please try again.', 'CARD_SETTINGS_UNAVAILABLE');
  }

  if (result.rows.length === 0) {
    return { codeLength: DEFAULT_CODE_LENGTH, speedLimit: null };
  }

  const row = result.rows[0];
  const codeLength = row.code_length ?? DEFAULT_CODE_LENGTH;

  if (row.speed_limit_enabled === false) {
    return { codeLength, speedLimit: null };
  }

  if (row.speed_limit_enabled !== true) {
    // Non-boolean value in a NOT NULL column — row is corrupt or from an unexpected path.
    logger.error('Unexpected speed_limit_enabled value in user_print_settings', { userId, type: typeof row.speed_limit_enabled });
    throw new AppError(503, 'Card settings are temporarily unavailable. Please try again.', 'CARD_SETTINGS_UNAVAILABLE');
  }

  const storedSpeed = row.speed_limit;
  if (!storedSpeed || !SPEED_VALUE_RE.test(storedSpeed)) {
    logger.error('Malformed speed_limit in user_print_settings', { userId, storedSpeed: '[redacted — malformed]' });
    throw new AppError(503, 'Card settings are temporarily unavailable. Please try again.', 'CARD_SETTINGS_UNAVAILABLE');
  }

  return { codeLength, speedLimit: storedSpeed };
}

/**
 * Retrieve speed-limit setting for a user.
 * Returns defaults when no row exists.
 */
export async function getCardSpeedSetting(userId: string): Promise<CardSpeedSetting> {
  try {
    const result = await pool.query<{ speed_limit_enabled: boolean; speed_limit: string }>(
      `SELECT speed_limit_enabled, speed_limit
         FROM user_print_settings
        WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return { enabled: false, speed: DEFAULT_SPEED_LIMIT, options: SPEED_LIMIT_OPTIONS };
    }

    return rowToCardSpeedSetting(result.rows[0]);
  } catch (error) {
    logger.error('Failed to get card speed setting', { error, userId });
    throw new AppError(503, 'Card settings are temporarily unavailable. Please try again.', 'CARD_SETTINGS_UNAVAILABLE');
  }
}

/**
 * Upsert only the speed-limit columns for the given user.
 */
export async function upsertCardSpeedSetting(
  userId: string,
  input: CardSpeedUpdate,
): Promise<CardSpeedSetting> {
  try {
    const result = await pool.query<{ speed_limit_enabled: boolean; speed_limit: string }>(
      CARD_SPEED_UPSERT_SQL,
      [userId, input.enabled, input.speed],
    );

    logger.info('Card speed setting upserted', { userId, enabled: input.enabled, speed: input.speed });
    return rowToCardSpeedSetting(result.rows[0]);
  } catch (error) {
    logger.error('Failed to upsert card speed setting', { error, userId });
    throw error;
  }
}
