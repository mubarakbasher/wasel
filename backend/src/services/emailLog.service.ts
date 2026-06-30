import { pool } from '../config/database';
import logger from '../config/logger';

export interface EmailLogRow {
  id: string;
  user_id: string | null;
  recipient: string;
  type: string;
  language: string;
  subject: string;
  status: string;
  error: string | null;
  created_at: string;
}

export interface RecordEmailParams {
  userId?: string | null;
  recipient: string;
  type: string;
  language: string;
  subject: string;
  status: 'sent' | 'failed';
  error?: string | null;
}

/**
 * Append-only insert into email_log. Error-swallowing — modelled on
 * audit.service.logAction so a logging failure never breaks email delivery.
 */
export async function recordSentEmail(params: RecordEmailParams): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO email_log (user_id, recipient, type, language, subject, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.userId ?? null,
        params.recipient,
        params.type,
        params.language,
        params.subject,
        params.status,
        params.error ?? null,
      ],
    );
    logger.info('Email log recorded', {
      type: params.type,
      status: params.status,
      recipient: params.recipient,
    });
  } catch (err) {
    logger.error('Failed to record email log', { error: err, type: params.type });
    // Don't throw — email log failure must never break mail delivery
  }
}

/**
 * Paginated, filtered query over email_log — mirrors getAuditLogs in admin.service.
 */
export async function getEmailLog(params: {
  page: number;
  limit: number;
  type?: string;
  status?: 'sent' | 'failed';
  search?: string;
  from?: string;
  to?: string;
}): Promise<{ logs: EmailLogRow[]; total: number; page: number; limit: number }> {
  const conditions: string[] = [];
  const queryParams: unknown[] = [];
  let paramIndex = 1;

  if (params.type) {
    conditions.push(`type = $${paramIndex++}`);
    queryParams.push(params.type);
  }

  if (params.status) {
    conditions.push(`status = $${paramIndex++}`);
    queryParams.push(params.status);
  }

  if (params.search) {
    conditions.push(`recipient ILIKE $${paramIndex++}`);
    queryParams.push(`%${params.search}%`);
  }

  if (params.from) {
    conditions.push(`created_at >= ($${paramIndex++})::date`);
    queryParams.push(params.from);
  }

  if (params.to) {
    conditions.push(`created_at < (($${paramIndex++})::date + INTERVAL '1 day')`);
    queryParams.push(params.to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (params.page - 1) * params.limit;

  const [dataResult, countResult] = await Promise.all([
    pool.query<EmailLogRow>(
      `SELECT * FROM email_log
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...queryParams, params.limit, offset],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM email_log ${whereClause}`,
      queryParams,
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  logger.info('Email log fetched', {
    page: params.page,
    limit: params.limit,
    total,
  });

  return {
    logs: dataResult.rows,
    total,
    page: params.page,
    limit: params.limit,
  };
}
