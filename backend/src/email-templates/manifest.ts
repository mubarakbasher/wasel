/**
 * Email template catalogue — the single source of truth for which template
 * types exist and what their built-in copy is.
 *
 * Everything else derives from this module instead of restating the list:
 *   - email.service         renders from it when no active DB row exists
 *   - emailTemplate.service serves one row per (type, language) to the admin
 *                           panel, synthesising the ones not yet in the DB
 *   - admin.validators      builds the PUT / test-send type enums from it
 *
 * It lives outside services/ and imports nothing on purpose: emailTemplate.service
 * must not import email.service (that closes a cycle — email.service imports
 * emailTemplate.service), so the catalogue both of them need has to sit below
 * both. Adding a type here makes it sendable, listable, editable and testable in
 * one edit.
 *
 * Entries are EN only — they are last-resort copy, and the AR rows are seeded by
 * migration / written by the admin. Bodies use the same {token} grammar
 * renderTemplate interpolates.
 */

export interface EmailTemplateDefault {
  subject: string;
  body_html: string;
}

const DEFAULT_TEMPLATES: Record<string, EmailTemplateDefault> = {
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
  support_message_admin: {
    subject: 'New support message from {user_name}',
    body_html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
<h2 style="color:#1a1a2e;">New Support Message</h2>
<p>A user has sent a support message that requires your attention.</p>
<p><strong>Name:</strong> {user_name}<br>
<strong>Email:</strong> {user_email}</p>
<div style="background:#f0f0f5;border-radius:8px;padding:16px;margin:16px 0;">
  <p style="margin:0;color:#1a1a2e;">{message}</p>
</div>
<p>Reply from the Wasel admin panel.</p>
</div>`,
  },
  support_reply_user: {
    subject: 'Wasel support replied to your message',
    body_html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
<h2 style="color:#1a1a2e;">Support Reply</h2>
<p>Hi {name},</p>
<p>The Wasel support team has replied to your message:</p>
<div style="background:#f0f0f5;border-radius:8px;padding:16px;margin:16px 0;">
  <p style="margin:0;color:#1a1a2e;">{message}</p>
</div>
<p>Open the Wasel app (Settings &rarr; Contact) to continue the conversation.</p>
</div>`,
  },
};

/**
 * Every template type the platform can send, in catalogue order.
 *
 * Typed as a non-empty tuple because z.enum needs one — same shape as
 * hotspotTemplateIds in admin.validators.ts.
 */
export const EMAIL_TEMPLATE_TYPES = Object.keys(DEFAULT_TEMPLATES) as [string, ...string[]];

/** Languages every type is offered in (matches the email_templates language CHECK). */
export const EMAIL_TEMPLATE_LANGUAGES = ['en', 'ar'] as const;

export type EmailTemplateLanguage = (typeof EMAIL_TEMPLATE_LANGUAGES)[number];

/**
 * Built-in copy for a template type, or undefined for a type not in the catalogue.
 *
 * Own-property lookup, not `DEFAULT_TEMPLATES[type]`: a type named `constructor`
 * or `toString` would otherwise resolve to an inherited Object member and read as
 * a hit. (`Object.hasOwn` would need lib ES2022; the backend targets ES2020, so
 * this matches the hasOwnProperty.call form already used in notificationStrings.)
 */
export function getDefaultTemplate(type: string): EmailTemplateDefault | undefined {
  return Object.prototype.hasOwnProperty.call(DEFAULT_TEMPLATES, type)
    ? DEFAULT_TEMPLATES[type]
    : undefined;
}
