import { pool } from '../config/database';
import logger from '../config/logger';

export async function logAction(params: {
  adminId: string;
  action: string;
  targetEntity: string;
  targetId: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (admin_id, action, target_entity, target_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.adminId,
        params.action,
        params.targetEntity,
        params.targetId,
        JSON.stringify(params.details || null),
        params.ipAddress || null,
      ],
    );
    logger.info('Audit log created', {
      action: params.action,
      targetEntity: params.targetEntity,
      targetId: params.targetId,
    });
  } catch (error) {
    logger.error('Failed to create audit log', { error, action: params.action });
    // Don't throw — audit logging failure should not break the main operation
  }
}
