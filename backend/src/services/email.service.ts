import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { pool } from '../config/database';
import logger from '../config/logger';
import { redis } from '../config/redis';
import { getDefaultTemplate } from '../email-templates/manifest';
import * as emailTemplateService from './emailTemplate.service';
import * as emailLogService from './emailLog.service';

// ---------------------------------------------------------------------------
// Transporter (lazy singleton)
// ---------------------------------------------------------------------------

let transporter: Transporter;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
      auth:
        config.SMTP_USER && config.SMTP_PASS
          ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
          : undefined,
    });
  }
  return transporter;
}

// ---------------------------------------------------------------------------
// HTML escaping — user-controlled param values are escaped before being
// interpolated into admin-trusted template HTML.
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  const str = String(s ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Placeholder derivation (admin panel "available placeholders" chips)
// ---------------------------------------------------------------------------

/** Same token grammar renderTemplate interpolates, matched whole. */
const PLACEHOLDER_PATTERN = /\{\w+\}/g;

/**
 * List the {token} placeholders a template type supports, in first-seen order
 * across subject then body_html, deduped and returned with braces.
 *
 * Derived from the canonical catalogue entry (EN — tokens are
 * language-independent) so the chips stay complete even after an admin deletes
 * a token from the saved DB copy. `fallback` — normally the row being served —
 * is scanned only for types with no catalogue entry.
 */
export function derivePlaceholders(
  type: string,
  fallback?: { subject: string; body_html: string },
): string[] {
  const tpl = getDefaultTemplate(type) ?? fallback;
  if (!tpl) return [];

  const tokens = new Set<string>();
  for (const source of [tpl.subject, tpl.body_html]) {
    for (const match of String(source ?? '').matchAll(PLACEHOLDER_PATTERN)) {
      tokens.add(match[0]);
    }
  }
  return [...tokens];
}

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

/**
 * Resolve and render a template. Resolution order:
 *   1. DB active row for (type, language)
 *   2. DB active row for (type, 'en')  [if language !== 'en']
 *   3. the built-in catalogue entry    [hard-coded fallback]
 *
 * For body_html: user-controlled param values are HTML-escaped (XSS prevention).
 * For subject:   param values are control-char-stripped (CRLF header-injection
 *               prevention) but NOT HTML-escaped — subjects are plain text.
 *
 * Returns null only when no DB row AND no catalogue entry exist for the given
 * type (purely defensive — every catalogued type has a built-in entry by
 * construction, so this only fires for a type invented at a call site).
 */
export async function renderTemplate(
  type: string,
  language: string,
  params: Record<string, string>,
): Promise<{ subject: string; body_html: string } | null> {
  let tpl = await emailTemplateService.getActiveTemplate(type, language);

  if (!tpl && language !== 'en') {
    tpl = await emailTemplateService.getActiveTemplate(type, 'en');
  }

  if (!tpl) {
    tpl = getDefaultTemplate(type) ?? null;
    if (!tpl) {
      logger.error('No template or default for type', { type });
      return null;
    }
  }

  // Interpolate {token} placeholders with per-destination escaping strategy.
  // Own-property check, not `key in params`: a template author writing
  // {constructor} must get the literal token back, not an inherited Object member.
  const interpolate = (s: string, opts: { escape: boolean }): string =>
    s.replace(/\{(\w+)\}/g, (_, key: string) => {
      if (!Object.prototype.hasOwnProperty.call(params, key)) return `{${key}}`;
      const raw = String(params[key] ?? '');
      return opts.escape ? escapeHtml(raw) : raw.replace(/[\r\n\t]+/g, ' ');
    });

  return {
    // Subject: no HTML encoding; per-token control-char strip + final strip/cap.
    subject: interpolate(tpl.subject, { escape: false }).replace(/[\r\n\t]+/g, ' ').slice(0, 255),
    // Body: HTML-escape every user-supplied token value.
    body_html: interpolate(tpl.body_html, { escape: true }),
  };
}

// ---------------------------------------------------------------------------
// Core sender
// ---------------------------------------------------------------------------

export interface SendTemplatedEmailParams {
  to: string;
  type: string;
  language: string;
  params: Record<string, string>;
  userId?: string | null;
}

/**
 * Render a template, send the email, and write to email_log.
 * If renderTemplate returns null (no template exists), logs an error and returns
 * without sending or writing a log row.
 * On SMTP failure: logs the error row and returns silently — email is
 * best-effort (same pattern as audit.service).
 */
export async function sendTemplatedEmail(opts: SendTemplatedEmailParams): Promise<void> {
  const rendered = await renderTemplate(opts.type, opts.language, opts.params);
  if (!rendered) {
    logger.error('No template found, skipping email send', { type: opts.type });
    return;
  }
  const { subject, body_html } = rendered;

  try {
    await getTransporter().sendMail({
      from: config.SMTP_FROM,
      to: opts.to,
      subject,
      html: body_html,
    });

    logger.debug('Email sent', { type: opts.type, to: opts.to, language: opts.language });

    await emailLogService.recordSentEmail({
      userId: opts.userId ?? null,
      recipient: opts.to,
      type: opts.type,
      language: opts.language,
      subject,
      status: 'sent',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to send email', { type: opts.type, to: opts.to, error: message });

    await emailLogService.recordSentEmail({
      userId: opts.userId ?? null,
      recipient: opts.to,
      type: opts.type,
      language: opts.language,
      subject,
      status: 'failed',
      error: message,
    });
    // Do NOT rethrow — email delivery is best-effort
  }
}

// ---------------------------------------------------------------------------
// OTP senders (backward-compatible; adds optional language param)
// ---------------------------------------------------------------------------

/**
 * Send an email verification OTP. Delegates to the templated email pipeline.
 * `language` defaults to 'en' for backward compatibility with existing callers.
 */
export async function sendVerificationOtp(
  email: string,
  name: string,
  otp: string,
  language = 'en',
): Promise<void> {
  await sendTemplatedEmail({
    to: email,
    type: 'verification_otp',
    language,
    params: { name, otp },
  });
}

/**
 * Send a password-reset OTP. Delegates to the templated email pipeline.
 */
export async function sendPasswordResetOtp(
  email: string,
  otp: string,
  language = 'en',
): Promise<void> {
  await sendTemplatedEmail({
    to: email,
    type: 'password_reset_otp',
    language,
    params: { otp },
  });
}

// ---------------------------------------------------------------------------
// Payment notification senders
// ---------------------------------------------------------------------------

/**
 * Fetch payment + payer + plan details and alert every active admin by email,
 * each in their own preferred language. Fire-and-forget from uploadReceipt.
 *
 * Deduped via Redis: at most one alert per paymentId per 5 minutes, preventing
 * fan-out when a user re-uploads a receipt repeatedly.
 */
export async function sendPaymentSubmittedAdminAlert(paymentId: string): Promise<void> {
  // Dedupe: one alert per payment per 5 minutes.
  const fresh = await redis.set(`email:payalert:${paymentId}`, '1', 'EX', 300, 'NX');
  if (fresh !== 'OK') {
    logger.debug('payment alert deduped', { paymentId });
    return;
  }

  // 1. Load payment details
  const paymentResult = await pool.query<{
    amount: string;
    currency: string;
    reference_code: string | null;
    plan_tier: string;
    user_name: string;
    user_email: string;
    plan_name: string | null;
  }>(
    `SELECT p.amount, p.currency, p.reference_code, p.plan_tier,
            u.name AS user_name, u.email AS user_email,
            pl.name AS plan_name
     FROM payments p
     JOIN users u ON p.user_id = u.id
     LEFT JOIN plans pl ON pl.tier = p.plan_tier
     WHERE p.id = $1`,
    [paymentId],
  );

  if (paymentResult.rows.length === 0) {
    logger.warn('sendPaymentSubmittedAdminAlert: payment not found', { paymentId });
    return;
  }

  const pmt = paymentResult.rows[0];
  const emailParams: Record<string, string> = {
    user_name: pmt.user_name,
    user_email: pmt.user_email,
    plan: pmt.plan_name ?? pmt.plan_tier,
    amount: String(pmt.amount),
    currency: pmt.currency,
    reference: pmt.reference_code ?? '',
  };

  // 2. Load all active admin users
  const adminResult = await pool.query<{ email: string; language: string | null }>(
    `SELECT email, language FROM users WHERE role = 'admin' AND is_active = TRUE`,
  );

  if (adminResult.rows.length === 0) {
    logger.warn('sendPaymentSubmittedAdminAlert: no active admins found');
    return;
  }

  // 3. Send to each admin in their own language (userId left null for admin-alert sends)
  await Promise.all(
    adminResult.rows.map((admin) =>
      sendTemplatedEmail({
        to: admin.email,
        type: 'payment_submitted_admin',
        language: admin.language === 'ar' ? 'ar' : 'en',
        params: emailParams,
        userId: null,
      }),
    ),
  );
}

/**
 * Notify the operator that their subscription payment was approved.
 */
export async function sendPaymentApproved(
  userId: string,
  planLabel: string,
  amount: string,
  currency: string,
): Promise<void> {
  const userRow = await resolveUserEmailAndLanguage(userId);
  if (!userRow) return;

  await sendTemplatedEmail({
    to: userRow.email,
    type: 'payment_approved',
    language: userRow.language,
    params: {
      name: userRow.name,
      plan: planLabel,
      amount,
      currency,
    },
    userId,
  });
}

/**
 * Notify the operator that their subscription payment was rejected.
 */
export async function sendPaymentRejected(
  userId: string,
  planLabel: string,
  reason: string,
): Promise<void> {
  const userRow = await resolveUserEmailAndLanguage(userId);
  if (!userRow) return;

  await sendTemplatedEmail({
    to: userRow.email,
    type: 'payment_rejected',
    language: userRow.language,
    params: {
      name: userRow.name,
      plan: planLabel,
      reason,
    },
    userId,
  });
}

// ---------------------------------------------------------------------------
// Test sender (admin panel "send test" button)
// ---------------------------------------------------------------------------

/** Fixed sample values that exercise every {token} across all template types. */
const SAMPLE_PARAMS: Record<string, string> = {
  name: 'Jane Doe',
  otp: '123456',
  user_name: 'Jane Doe',
  user_email: 'jane@example.com',
  plan: 'Starter',
  amount: '5.00',
  currency: 'SDG',
  reference: 'WSL-TEST-0001',
  reason: 'Sample reason — receipt image was unreadable',
  message: 'This is a sample support message for preview purposes.',
};

/**
 * Render `type`/`language` with fixed sample data and send ONLY to `adminEmail`.
 * Logged like any other send; userId is left null.
 */
export async function sendTestEmail(
  type: string,
  language: string,
  adminEmail: string,
): Promise<void> {
  await sendTemplatedEmail({
    to: adminEmail,
    type,
    language,
    params: SAMPLE_PARAMS,
    userId: null,
  });
}

// ---------------------------------------------------------------------------
// Support-chat notification senders
// ---------------------------------------------------------------------------

/**
 * Alert every active admin by email when a user sends a support message.
 * Deduped via Redis: at most one alert per userId per 10 minutes so chat
 * bursts (user sends several messages rapidly) do not fan out N times.
 */
export async function sendSupportMessageAdminAlert(userId: string, message: string): Promise<void> {
  // Dedupe: one alert per user-thread per 10 minutes.
  const fresh = await redis.set(`email:supportalert:${userId}`, '1', 'EX', 600, 'NX');
  if (fresh !== 'OK') {
    logger.debug('support admin alert deduped', { userId });
    return;
  }

  // 1. Load sender name and email.
  const userResult = await pool.query<{ name: string; email: string }>(
    `SELECT name, email FROM users WHERE id = $1 AND is_active = TRUE`,
    [userId],
  );
  if (userResult.rows.length === 0) {
    logger.warn('sendSupportMessageAdminAlert: user not found', { userId });
    return;
  }
  const user = userResult.rows[0];
  const emailParams: Record<string, string> = {
    user_name: user.name,
    user_email: user.email,
    message,
  };

  // 2. Load all active admin users.
  const adminResult = await pool.query<{ email: string; language: string | null }>(
    `SELECT email, language FROM users WHERE role = 'admin' AND is_active = TRUE`,
  );
  if (adminResult.rows.length === 0) {
    logger.warn('sendSupportMessageAdminAlert: no active admins found');
    return;
  }

  // 3. Send to each admin in their own language (userId null for admin-alert log entries).
  await Promise.all(
    adminResult.rows.map((admin) =>
      sendTemplatedEmail({
        to: admin.email,
        type: 'support_message_admin',
        language: admin.language === 'ar' ? 'ar' : 'en',
        params: emailParams,
        userId: null,
      }),
    ),
  );
}

/**
 * Notify the user by email when an admin replies to their support thread.
 * No dedupe — every reply gets its own email (replies are intentional
 * admin actions, not user-triggered bursts).
 */
export async function sendSupportReplyEmail(userId: string, message: string): Promise<void> {
  const userRow = await resolveUserEmailAndLanguage(userId);
  if (!userRow) return;

  await sendTemplatedEmail({
    to: userRow.email,
    type: 'support_reply_user',
    language: userRow.language,
    params: {
      name: userRow.name,
      message,
    },
    userId,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function resolveUserEmailAndLanguage(
  userId: string,
): Promise<{ email: string; name: string; language: string } | null> {
  try {
    const result = await pool.query<{ email: string; name: string; language: string | null }>(
      `SELECT email, name, language FROM users WHERE id = $1 AND is_active = TRUE`,
      [userId],
    );
    if (result.rows.length === 0) {
      logger.warn('resolveUserEmailAndLanguage: user not found', { userId });
      return null;
    }
    const row = result.rows[0];
    return {
      email: row.email,
      name: row.name,
      language: row.language === 'ar' ? 'ar' : 'en',
    };
  } catch (err) {
    logger.error('resolveUserEmailAndLanguage: DB error', { error: err, userId });
    return null;
  }
}
