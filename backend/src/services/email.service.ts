import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { pool } from '../config/database';
import logger from '../config/logger';
import { redis } from '../config/redis';
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
// Hard-coded fallback templates (one per type, EN only).
// These are used when the DB row is missing or inactive so email delivery
// never silently fails due to a missing/deactivated template.
// ---------------------------------------------------------------------------

const DEFAULT_TEMPLATES: Record<string, { subject: string; body_html: string }> = {
  verification_otp: {
    subject: 'Wasel - Verify Your Email',
    body_html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
<h2 style="color:#1a1a2e;">Welcome to Wasel!</h2>
<p>Hi {name},</p>
<p>Your email verification code is:</p>
<div style="background:#f0f0f5;border-radius:8px;padding:16px;text-align:center;margin:24px 0;">
  <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1a1a2e;">{otp}</span>
</div>
<p>This code expires in <strong>24 hours</strong>.</p>
<p style="color:#666;font-size:13px;">If you did not create a Wasel account, you can safely ignore this email.</p>
</div>`,
  },
  password_reset_otp: {
    subject: 'Wasel - Password Reset Code',
    body_html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
<h2 style="color:#1a1a2e;">Password Reset</h2>
<p>You requested a password reset for your Wasel account.</p>
<p>Your reset code is:</p>
<div style="background:#f0f0f5;border-radius:8px;padding:16px;text-align:center;margin:24px 0;">
  <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1a1a2e;">{otp}</span>
</div>
<p>This code expires in <strong>15 minutes</strong>.</p>
<p style="color:#666;font-size:13px;">If you did not request this, you can safely ignore this email. Your password will not change.</p>
</div>`,
  },
  payment_submitted_admin: {
    subject: '[Wasel Admin] New Payment Submission from {user_name}',
    body_html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
<h2 style="color:#1a1a2e;">New Payment Submission</h2>
<p>A user has submitted a payment that requires your review.</p>
<p><strong>Name:</strong> {user_name}<br>
<strong>Email:</strong> {user_email}<br>
<strong>Plan:</strong> {plan}<br>
<strong>Amount:</strong> {amount} {currency}<br>
<strong>Reference:</strong> {reference}</p>
<p>Please log in to the admin panel to approve or reject this payment.</p>
</div>`,
  },
  payment_approved: {
    subject: 'Wasel - Your Payment Has Been Approved',
    body_html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
<h2 style="color:#1a1a2e;">Payment Approved</h2>
<p>Hi {name},</p>
<p>Your payment has been approved. Your <strong>{plan}</strong> subscription is now active.</p>
<p>Amount paid: <strong>{amount} {currency}</strong></p>
<p>Thank you for choosing Wasel.</p>
</div>`,
  },
  payment_rejected: {
    subject: 'Wasel - Payment Could Not Be Verified',
    body_html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
<h2 style="color:#1a1a2e;">Payment Rejected</h2>
<p>Hi {name},</p>
<p>Unfortunately your payment for the <strong>{plan}</strong> plan could not be verified.</p>
<p><strong>Reason:</strong> {reason}</p>
<p>You can re-upload your receipt and resubmit your payment from the app.</p>
</div>`,
  },
};

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

/**
 * Resolve and render a template. Resolution order:
 *   1. DB active row for (type, language)
 *   2. DB active row for (type, 'en')  [if language !== 'en']
 *   3. DEFAULT_TEMPLATES[type]          [hard-coded fallback]
 *
 * For body_html: user-controlled param values are HTML-escaped (XSS prevention).
 * For subject:   param values are control-char-stripped (CRLF header-injection
 *               prevention) but NOT HTML-escaped — subjects are plain text.
 *
 * Returns null only when no DB row AND no DEFAULT_TEMPLATES entry exist for the
 * given type (purely defensive; all 5 known types always have a DEFAULT entry).
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
    tpl = DEFAULT_TEMPLATES[type];
    if (!tpl) {
      logger.error('No template or default for type', { type });
      return null;
    }
  }

  // Interpolate {token} placeholders with per-destination escaping strategy.
  const interpolate = (s: string, opts: { escape: boolean }): string =>
    s.replace(/\{(\w+)\}/g, (_, key: string) => {
      if (!(key in params)) return `{${key}}`;
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

/** Fixed sample values that exercise every {token} across all 5 template types. */
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
