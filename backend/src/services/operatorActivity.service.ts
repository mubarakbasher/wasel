import { pool } from '../config/database';
import logger from '../config/logger';

export async function touchOperatorActivity(userId: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO operator_activity (user_id, last_active_at) VALUES ($1, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET last_active_at = NOW()
       WHERE operator_activity.last_active_at < NOW() - INTERVAL '5 minutes'`,
      [userId],
    );
  } catch (err) {
    logger.error('touchOperatorActivity failed', { userId, err });
  }
}
