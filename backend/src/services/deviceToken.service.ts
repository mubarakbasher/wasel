import { pool } from '../config/database';
import logger from '../config/logger';

export async function registerToken(
  userId: string,
  token: string,
  platform: 'android' | 'ios',
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO device_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, token)
       DO UPDATE SET platform = EXCLUDED.platform, updated_at = NOW()`,
      [userId, token, platform],
    );
    logger.info('Device token registered', { userId, platform });
  } catch (error) {
    logger.error('Failed to register device token', { error, userId });
    throw error;
  }
}

export async function unregisterToken(
  userId: string,
  token: string,
): Promise<void> {
  try {
    await pool.query(
      'DELETE FROM device_tokens WHERE user_id = $1 AND token = $2',
      [userId, token],
    );
    logger.info('Device token unregistered', { userId });
  } catch (error) {
    logger.error('Failed to unregister device token', { error, userId });
    throw error;
  }
}

export async function getTokensForUser(
  userId: string,
): Promise<{ token: string; platform: string }[]> {
  try {
    const result = await pool.query(
      'SELECT token, platform FROM device_tokens WHERE user_id = $1',
      [userId],
    );
    return result.rows;
  } catch (error) {
    logger.error('Failed to get device tokens for user', { error, userId });
    throw error;
  }
}

export async function removeStaleTokens(token: string): Promise<void> {
  try {
    await pool.query('DELETE FROM device_tokens WHERE token = $1', [token]);
    logger.info('Stale device token removed');
  } catch (error) {
    logger.error('Failed to remove stale device token', { error });
    throw error;
  }
}
