import { pool } from '../config/database';
import logger from '../config/logger';

export async function getPreferences(
  userId: string,
): Promise<{ category: string; enabled: boolean }[]> {
  try {
    const result = await pool.query(
      'SELECT category, enabled FROM notification_preferences WHERE user_id = $1',
      [userId],
    );
    return result.rows;
  } catch (error) {
    logger.error('Failed to get notification preferences', { error, userId });
    throw error;
  }
}

export async function updatePreferences(
  userId: string,
  prefs: { category: string; enabled: boolean }[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const pref of prefs) {
      await client.query(
        `INSERT INTO notification_preferences (user_id, category, enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, category)
         DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
        [userId, pref.category, pref.enabled],
      );
    }
    await client.query('COMMIT');
    logger.info('Notification preferences updated', { userId, count: prefs.length });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to update notification preferences', { error, userId });
    throw error;
  } finally {
    client.release();
  }
}

export async function isNotificationEnabled(
  userId: string,
  category: string,
): Promise<boolean> {
  try {
    const result = await pool.query(
      'SELECT enabled FROM notification_preferences WHERE user_id = $1 AND category = $2',
      [userId, category],
    );
    // Opt-out model: if no row exists, notification is enabled by default
    if (result.rows.length === 0) {
      return true;
    }
    return result.rows[0].enabled;
  } catch (error) {
    logger.error('Failed to check notification enabled status', { error, userId, category });
    throw error;
  }
}
