import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';

export interface EmailTemplateRow {
  id: string;
  type: string;
  language: string;
  subject: string;
  body_html: string;
  is_active: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Fetch the active template for (type, language). Returns null if not found or
 * inactive. Called by email.service — this module intentionally imports only
 * pool/logger to avoid a circular dependency.
 */
export async function getActiveTemplate(
  type: string,
  language: string,
): Promise<{ subject: string; body_html: string } | null> {
  try {
    const result = await pool.query<{ subject: string; body_html: string }>(
      `SELECT subject, body_html
       FROM email_templates
       WHERE type = $1 AND language = $2 AND is_active = TRUE
       LIMIT 1`,
      [type, language],
    );
    return result.rows[0] ?? null;
  } catch (err) {
    logger.error('Failed to fetch email template', { error: err, type, language });
    return null;
  }
}

/**
 * Return all email templates ordered by type then language, for the admin panel.
 */
export async function listEmailTemplates(): Promise<EmailTemplateRow[]> {
  const result = await pool.query<EmailTemplateRow>(
    `SELECT * FROM email_templates ORDER BY type, language`,
  );
  return result.rows;
}

/**
 * Partially update an email template. Throws 404 if (type, language) does not exist.
 */
export async function updateEmailTemplate(
  type: string,
  language: string,
  data: { subject?: string; body_html?: string; is_active?: boolean },
  adminId: string,
): Promise<EmailTemplateRow> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.subject !== undefined) {
    setClauses.push(`subject = $${paramIndex++}`);
    params.push(data.subject);
  }
  if (data.body_html !== undefined) {
    setClauses.push(`body_html = $${paramIndex++}`);
    params.push(data.body_html);
  }
  if (data.is_active !== undefined) {
    setClauses.push(`is_active = $${paramIndex++}`);
    params.push(data.is_active);
  }

  // Always stamp updated_by; updated_at is handled by the DB trigger but we
  // include it explicitly so the RETURNING * reflects the new timestamp.
  setClauses.push(`updated_by = $${paramIndex++}`);
  params.push(adminId);
  setClauses.push(`updated_at = NOW()`);

  const result = await pool.query<EmailTemplateRow>(
    `UPDATE email_templates
     SET ${setClauses.join(', ')}
     WHERE type = $${paramIndex} AND language = $${paramIndex + 1}
     RETURNING *`,
    [...params, type, language],
  );

  if (result.rowCount === 0) {
    throw new AppError(
      404,
      `Email template not found: ${type}/${language}`,
      'EMAIL_TEMPLATE_NOT_FOUND',
    );
  }

  logger.info('Email template updated', { type, language, adminId });
  return result.rows[0];
}
