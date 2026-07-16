import { pool } from '../config/database';
import logger from '../config/logger';
import * as notificationService from './notification.service';

/**
 * A broadcast announcement as returned to the admin history list. Bilingual
 * copy is carried verbatim (the recipient's stored language decides which pair
 * they actually saw in their inbox at fan-out time).
 */
export interface AnnouncementListItem {
  id: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  audience: string;
  recipientCount: number;
  pushSuccessCount: number | null;
  pushFailureCount: number | null;
  createdAt: string;
  adminName: string | null;
}

interface AnnouncementRow {
  id: string;
  title_en: string;
  body_en: string;
  title_ar: string;
  body_ar: string;
  audience: string;
  recipient_count: number;
  push_success_count: number | null;
  push_failure_count: number | null;
  created_at: Date;
  admin_name: string | null;
}

function toAnnouncement(row: AnnouncementRow): AnnouncementListItem {
  return {
    id: row.id,
    titleEn: row.title_en,
    titleAr: row.title_ar,
    bodyEn: row.body_en,
    bodyAr: row.body_ar,
    audience: row.audience,
    recipientCount: row.recipient_count,
    pushSuccessCount: row.push_success_count,
    pushFailureCount: row.push_failure_count,
    createdAt: new Date(row.created_at).toISOString(),
    adminName: row.admin_name,
  };
}

interface AnnouncementCopy {
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}

// The audience predicate is shared verbatim by the inbox fan-out and the push
// token fetch so both target exactly the same recipient set: active end users
// (not admins) who have not opted out of the 'announcement' category. The
// notification_preferences model is per-category opt-out (missing row = enabled),
// so a LEFT JOIN + COALESCE(np.enabled, TRUE) honours it without requiring a row.
const AUDIENCE_PREDICATE = `
  WHERE u.role = 'user'
    AND u.is_active = TRUE
    AND COALESCE(np.enabled, TRUE) = TRUE`;

/**
 * Create a broadcast announcement and fan it out to every active end user's
 * in-app inbox in a single transaction:
 *   1. INSERT the announcements row.
 *   2. A single-statement INSERT ... SELECT into notifications (no per-user loop)
 *      that localizes title/body from the recipient's stored language.
 *   3. UPDATE recipient_count from the fan-out rowCount, then COMMIT.
 *
 * The returned { id, recipientCount } is resolved as soon as the transaction
 * commits — the HTTP response never waits for push delivery. FCM multicast is
 * kicked off fire-and-forget afterwards (see dispatchAnnouncementPush): it can
 * never reject the caller and no-ops cleanly when FCM is unconfigured.
 */
export async function createAnnouncement(params: {
  adminId: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}): Promise<{ id: string; recipientCount: number }> {
  const client = await pool.connect();
  let announcementId: string;
  let recipientCount: number;

  try {
    await client.query('BEGIN');

    const insertRes = await client.query<{ id: string }>(
      `INSERT INTO announcements (admin_id, title_en, body_en, title_ar, body_ar, audience)
       VALUES ($1, $2, $3, $4, $5, 'all_active')
       RETURNING id`,
      [params.adminId, params.titleEn, params.bodyEn, params.titleAr, params.bodyAr],
    );
    announcementId = insertRes.rows[0].id;

    const fanout = await client.query(
      `INSERT INTO notifications (user_id, category, title, body, data)
       SELECT u.id, 'announcement',
              CASE WHEN u.language = 'ar' THEN $1 ELSE $2 END,
              CASE WHEN u.language = 'ar' THEN $3 ELSE $4 END,
              jsonb_build_object('announcementId', $5::text)
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id AND np.category = 'announcement'
       ${AUDIENCE_PREDICATE}`,
      [params.titleAr, params.titleEn, params.bodyAr, params.bodyEn, announcementId],
    );
    recipientCount = fanout.rowCount ?? 0;

    await client.query(
      `UPDATE announcements SET recipient_count = $1 WHERE id = $2`,
      [recipientCount, announcementId],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to create announcement', { error });
    throw error;
  } finally {
    client.release();
  }

  logger.info('Announcement created', { announcementId, recipientCount });

  // Fire-and-forget push AFTER commit. dispatchAnnouncementPush swallows all of
  // its own errors; the extra .catch is defensive so a rejected promise can
  // never surface as an unhandled rejection.
  void dispatchAnnouncementPush(announcementId, {
    titleEn: params.titleEn,
    titleAr: params.titleAr,
    bodyEn: params.bodyEn,
    bodyAr: params.bodyAr,
  }).catch((error) =>
    logger.error('Announcement push dispatch rejected', { error, announcementId }),
  );

  return { id: announcementId, recipientCount };
}

/**
 * Best-effort FCM broadcast for an announcement. Runs after the inbox fan-out
 * has committed, so a push failure never affects the recorded recipient count
 * or the HTTP response. Fetches device tokens for the SAME audience predicate,
 * groups them by the owner's language, sends one multicast per language group,
 * then records the aggregate success/failure counts back on the announcement.
 *
 * Never throws. No-ops before touching the DB when FCM is unconfigured (dev).
 */
async function dispatchAnnouncementPush(
  announcementId: string,
  copy: AnnouncementCopy,
): Promise<void> {
  try {
    if (!notificationService.isFcmAvailable()) {
      logger.info('Announcement push skipped — FCM unavailable', { announcementId });
      return;
    }

    const tokensRes = await pool.query<{ token: string; language: string }>(
      `SELECT dt.token, u.language
       FROM device_tokens dt
       JOIN users u ON u.id = dt.user_id
       LEFT JOIN notification_preferences np ON np.user_id = u.id AND np.category = 'announcement'
       ${AUDIENCE_PREDICATE}`,
    );

    const arTokens = tokensRes.rows.filter((r) => r.language === 'ar').map((r) => r.token);
    const enTokens = tokensRes.rows.filter((r) => r.language !== 'ar').map((r) => r.token);

    const data: Record<string, string> = { category: 'announcement', announcementId };

    const [arResult, enResult] = await Promise.all([
      notificationService.sendMulticast(arTokens, { title: copy.titleAr, body: copy.bodyAr }, data),
      notificationService.sendMulticast(enTokens, { title: copy.titleEn, body: copy.bodyEn }, data),
    ]);

    const successCount = arResult.successCount + enResult.successCount;
    const failureCount = arResult.failureCount + enResult.failureCount;

    await pool.query(
      `UPDATE announcements SET push_success_count = $1, push_failure_count = $2 WHERE id = $3`,
      [successCount, failureCount, announcementId],
    );

    logger.info('Announcement push dispatched', { announcementId, successCount, failureCount });
  } catch (error) {
    logger.error('Announcement push failed', { error, announcementId });
  }
}

/**
 * Paginated announcement history, newest first, with the sending admin's name
 * resolved via LEFT JOIN (null when the admin row was later deleted).
 */
export async function listAnnouncements(
  page: number,
  limit: number,
): Promise<{ items: AnnouncementListItem[]; total: number; page: number; limit: number }> {
  const offset = (page - 1) * limit;

  const [itemsRes, countRes] = await Promise.all([
    pool.query<AnnouncementRow>(
      `SELECT a.id, a.title_en, a.body_en, a.title_ar, a.body_ar, a.audience,
              a.recipient_count, a.push_success_count, a.push_failure_count, a.created_at,
              u.name AS admin_name
       FROM announcements a
       LEFT JOIN users u ON u.id = a.admin_id
       ORDER BY a.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM announcements`),
  ]);

  return {
    items: itemsRes.rows.map(toAnnouncement),
    total: parseInt(countRes.rows[0].count, 10),
    page,
    limit,
  };
}
