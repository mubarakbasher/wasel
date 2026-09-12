/**
 * Shared email-template catalogue for the Email Templates editor and the Email
 * Log filter.
 *
 * The set of template types lives in the backend (one row per type per
 * language), so both pages derive their type list from the fetched rows rather
 * than from a literal here — a type added on the backend shows up in the panel
 * on its own. This module only supplies presentation: display order and
 * labels. Both pages fetch through `EMAIL_TEMPLATES_KEY` / `fetchEmailTemplates`
 * so the second one is served from the React Query cache under the app-wide
 * staleTime set in App.tsx — neither should raise it locally, since a longer
 * window only lets the editor seed its form from staler data and then blind-
 * overwrite a concurrent save.
 */

import api from './api';

export interface EmailTemplate {
  id: string;
  type: string;
  language: 'en' | 'ar';
  subject: string;
  body_html: string;
  is_active: boolean;
  /** null on a synthetic row — a catalogue entry with no DB row behind it yet. */
  created_at: string | null;
  updated_at: string | null;
  /**
   * False for a stored row whose type has left the backend catalogue: the write
   * routes reject that type, so saving or test-sending it 400s.
   */
  is_editable: boolean;
  /** Tokens this template supports, e.g. ["{name}", "{otp}"]. */
  placeholders?: string[];
}

export const EMAIL_TEMPLATES_KEY = ['email-templates'] as const;

export async function fetchEmailTemplates(): Promise<EmailTemplate[]> {
  const { data: res } = await api.get('/admin/email-templates');
  return res.data as EmailTemplate[];
}

// Preferred display order. Anything absent from this list is appended
// alphabetically, so an unrecognised type is still reachable in the UI.
const TYPE_ORDER = [
  'verification_otp',
  'password_reset_otp',
  'payment_submitted_admin',
  'payment_approved',
  'payment_rejected',
  'support_message_admin',
  'support_reply_user',
];

// Only for codes the humanizer gets wrong or too plain ("Verification Otp").
const TYPE_LABEL_OVERRIDES = new Map<string, string>([
  ['verification_otp', 'Verification OTP'],
  ['password_reset_otp', 'Password Reset OTP'],
  ['payment_submitted_admin', 'Payment Submitted (Admin)'],
  ['payment_approved', 'Payment Approved'],
  ['payment_rejected', 'Payment Rejected'],
  ['support_message_admin', 'Support Message (Admin)'],
  ['support_reply_user', 'Support Reply (User)'],
]);

function humanize(type: string): string {
  return type
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Display label for a template type code, humanizing unrecognised codes. */
export function templateTypeLabel(type: string): string {
  return TYPE_LABEL_OVERRIDES.get(type) ?? humanize(type);
}

/** Distinct template types from the fetched rows, in display order. */
export function templateTypesFrom(rows: readonly { type: string }[]): string[] {
  const present = new Set(rows.map((row) => row.type));
  const known = TYPE_ORDER.filter((type) => present.has(type));
  const unknown = [...present].filter((type) => !TYPE_ORDER.includes(type)).sort();
  return [...known, ...unknown];
}
