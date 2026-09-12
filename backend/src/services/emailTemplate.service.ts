import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import {
  EMAIL_TEMPLATE_TYPES,
  EMAIL_TEMPLATE_LANGUAGES,
  getDefaultTemplate,
} from '../email-templates/manifest';

/** An `email_templates` row exactly as `SELECT *` returns it. */
interface StoredTemplateRow {
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

/** A row as served to the admin panel — the stored shape plus what it cannot carry. */
export interface EmailTemplateRow extends Omit<StoredTemplateRow, 'created_at' | 'updated_at'> {
  /** null on a synthetic row — it has never been written to the DB. */
  created_at: string | null;
  updated_at: string | null;
  /**
   * Whether the write routes accept this row's type at all. The PUT and
   * test-send enums derive from the catalogue, so a stored row whose type has
   * since left it is read-only: every save for it 400s. The panel disables Save
   * and Send-test on those rather than offering an edit that cannot land. True
   * for every catalogue row, stored or synthetic.
   */
  is_editable: boolean;
}

/**
 * Prefix marking a row that exists only in the code catalogue. Real ids are
 * UUIDs, so a `default:` prefix can never collide with one, and the panel's
 * "don't stomp unsaved edits on background refetch" guard (which keys off the
 * row id) sees a stable identity across fetches.
 */
const SYNTHETIC_TEMPLATE_ID_PREFIX = 'default:';

/** Deterministic id for the synthetic row of a (type, language) pair. */
export function syntheticTemplateId(type: string, language: string): string {
  return `${SYNTHETIC_TEMPLATE_ID_PREFIX}${type}:${language}`;
}

/** True when the catalogue-derived PUT / test-send type enums accept `type`. */
function isEditableType(type: string): boolean {
  return getDefaultTemplate(type) !== undefined;
}

/** Decorate a stored row with the fields only the serving layer knows about. */
function servedRow(row: StoredTemplateRow): EmailTemplateRow {
  return { ...row, is_editable: isEditableType(row.type) };
}

/**
 * Fetch the active template for (type, language). Returns null if not found or
 * inactive. Called by email.service — this module intentionally imports only
 * pool/logger/the catalogue to avoid a circular dependency.
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
 * The row the admin panel shows for a catalogue entry with no DB row yet.
 *
 * It is not a placeholder for something inert: renderTemplate falls back when no
 * active row exists, so an unseeded pair sends real mail and writes email_log
 * rows. Hiding it would leave it missing from the template editor and the
 * email-log type filter while it is demonstrably in use — hence is_active TRUE,
 * which is what the fallback actually does. created_at/updated_at are null so
 * the panel renders its em-dash "never" state instead of a bogus timestamp.
 *
 * The copy it shows has to be the copy that would be sent, so it walks the rest
 * of renderTemplate's chain: `storedEn` — the active stored EN row for the type,
 * when there is one — before the built-in entry. Reading the catalogue
 * unconditionally would preview the built-in text for an AR pair whose EN half
 * the admin has already rewritten, while a live AR send uses that rewritten EN.
 */
function syntheticTemplateRow(
  type: string,
  language: string,
  storedEn?: Pick<StoredTemplateRow, 'subject' | 'body_html'>,
): EmailTemplateRow {
  const fallback = storedEn ?? getDefaultTemplate(type);
  return {
    id: syntheticTemplateId(type, language),
    type,
    language,
    subject: fallback?.subject ?? '',
    body_html: fallback?.body_html ?? '',
    is_active: true,
    updated_by: null,
    created_at: null,
    updated_at: null,
    is_editable: isEditableType(type),
  };
}

/**
 * Return one row per (catalogue type x language) for the admin panel: the DB row
 * when it exists, otherwise a synthetic one. Stored rows for types no longer in
 * the catalogue are appended so they stay visible in the editor and the
 * email-log type filter, carrying is_editable false — the write routes reject
 * their type, so the panel shows them read-only.
 */
export async function listEmailTemplates(): Promise<EmailTemplateRow[]> {
  const result = await pool.query<StoredTemplateRow>(
    `SELECT * FROM email_templates ORDER BY type, language`,
  );

  const stored = new Map(result.rows.map((row) => [`${row.type}:${row.language}`, row]));
  // Seed source for the synthetic rows: step 2 of renderTemplate's chain, which
  // is the active EN row — an inactive one is skipped there and here alike.
  const activeEn = new Map(
    result.rows
      .filter((row) => row.language === 'en' && row.is_active)
      .map((row) => [row.type, row]),
  );
  const catalogue: EmailTemplateRow[] = [];

  for (const type of EMAIL_TEMPLATE_TYPES) {
    for (const language of EMAIL_TEMPLATE_LANGUAGES) {
      const key = `${type}:${language}`;
      const row = stored.get(key);
      catalogue.push(
        row ? servedRow(row) : syntheticTemplateRow(type, language, activeEn.get(type)),
      );
      stored.delete(key);
    }
  }

  return [...catalogue, ...[...stored.values()].map((row) => servedRow(row))];
}

export interface SavedEmailTemplate {
  row: EmailTemplateRow;
  /**
   * Whether the save inserted rather than updated. Read off `xmax = 0` in the
   * RETURNING clause — 0 only on a tuple this statement created — so the caller
   * can tell the two halves of the upsert apart without a second query.
   */
  created: boolean;
}

/**
 * Create or update the template for (type, language).
 *
 * An upsert, not an update: listEmailTemplates serves a synthetic row for every
 * catalogue entry with no DB row, so the first save of one of those has to
 * persist it — a 404 there would throw away the whole template the admin just
 * wrote. Fields the caller omitted are seeded from the catalogue on insert and
 * left untouched on update, so a partial edit stays partial.
 */
export async function updateEmailTemplate(
  type: string,
  language: string,
  data: { subject?: string; body_html?: string; is_active?: boolean },
  adminId: string,
): Promise<SavedEmailTemplate> {
  const fallback = getDefaultTemplate(type);
  const subject = data.subject ?? fallback?.subject;
  const bodyHtml = data.body_html ?? fallback?.body_html;

  // A type outside the catalogue has nothing to seed the NOT NULL columns from,
  // so it can only ever be updated in place (a row left behind by a removed
  // type). The route enum rejects those before they get here; this keeps the
  // service honest for direct callers.
  if (subject === undefined || bodyHtml === undefined) {
    return updateStoredTemplate(type, language, data, adminId);
  }

  // Only the supplied fields are overwritten on conflict; the rest keep the
  // stored value. updated_at is set explicitly so RETURNING * carries the new
  // timestamp (the BEFORE UPDATE trigger would set it after the fact).
  const setClauses: string[] = [];
  if (data.subject !== undefined) setClauses.push(`subject = EXCLUDED.subject`);
  if (data.body_html !== undefined) setClauses.push(`body_html = EXCLUDED.body_html`);
  if (data.is_active !== undefined) setClauses.push(`is_active = EXCLUDED.is_active`);
  setClauses.push(`updated_by = EXCLUDED.updated_by`);
  setClauses.push(`updated_at = NOW()`);

  const result = await pool.query<StoredTemplateRow & { created: boolean }>(
    `INSERT INTO email_templates (type, language, subject, body_html, is_active, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (type, language) DO UPDATE
     SET ${setClauses.join(', ')}
     RETURNING *, (xmax = 0) AS created`,
    [type, language, subject, bodyHtml, data.is_active ?? true, adminId],
  );

  const { created, ...row } = result.rows[0];
  logger.info('Email template saved', { type, language, adminId, created });
  return { row: servedRow(row), created: created === true };
}

/**
 * In-place update for a type with no catalogue entry. Cannot be an upsert —
 * there is no built-in copy to seed subject/body_html from — so a missing row
 * is still a 404.
 *
 * Service-level only: the PUT route rejects a de-catalogued type with a 400
 * before it can reach this, since its enum derives from the catalogue. It stays
 * for direct callers — a script deactivating a retired row is the only way one
 * can be changed, which is why listEmailTemplates serves those is_editable false.
 */
async function updateStoredTemplate(
  type: string,
  language: string,
  data: { subject?: string; body_html?: string; is_active?: boolean },
  adminId: string,
): Promise<SavedEmailTemplate> {
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

  setClauses.push(`updated_by = $${paramIndex++}`);
  params.push(adminId);
  setClauses.push(`updated_at = NOW()`);

  const result = await pool.query<StoredTemplateRow>(
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
  return { row: servedRow(result.rows[0]), created: false };
}
