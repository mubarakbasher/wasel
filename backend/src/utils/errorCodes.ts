/**
 * Canonical machine-readable error codes for all 4xx (and a few 5xx) responses.
 *
 * Every code here is stable — the mobile / admin clients build i18n maps
 * keyed on these strings.  Never rename a code; add new ones when needed.
 *
 * Organisation mirrors the API surface:
 *   AUTH_*         – authentication / authorisation
 *   VALIDATION_*   – request shape / field validation
 *   QUOTA_*        – subscription quota / tier limits
 *   SUBSCRIPTION_* – subscription state
 *   ROUTER_*       – router management
 *   VOUCHER_*      – voucher lifecycle
 *   PROFILE_*      – radius profile CRUD
 *   SESSION_*      – hotspot session management
 *   NOTIFICATION_* – in-app inbox
 *   SUPPORT_*      – support messages
 *   PAYMENT_*      – payment review / approval
 *   PLAN_*         – plan management (admin)
 *   ADMIN_*        – admin-panel-specific guards
 *   CURSOR_*       – pagination cursor
 *   REPORT_*       – report generation / export
 *   TEMPLATE_*     – hotspot captive-portal templates
 *   USERNAME_*     – RADIUS username allocation
 *   NOT_FOUND      – generic not-found (prefer the domain-specific code)
 *   INTERNAL_ERROR – uncaught 500
 */

export const ErrorCodes = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_PASSWORD: 'INVALID_PASSWORD',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  RATE_LIMITED: 'RATE_LIMITED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  ALREADY_VERIFIED: 'ALREADY_VERIFIED',
  OTP_INVALID: 'OTP_INVALID',
  EMAIL_EXISTS: 'EMAIL_EXISTS',
  EMAIL_UNCHANGED: 'EMAIL_UNCHANGED',
  EMAIL_CHANGE_INVALID: 'EMAIL_CHANGE_INVALID',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_REVOKED: 'REFRESH_TOKEN_REVOKED',

  // ── Validation ────────────────────────────────────────────────────────────
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  DATE_RANGE_TOO_LARGE: 'DATE_RANGE_TOO_LARGE',
  NO_FIELDS_TO_UPDATE: 'NO_FIELDS_TO_UPDATE',

  // ── Cursor / pagination ───────────────────────────────────────────────────
  INVALID_CURSOR: 'INVALID_CURSOR',

  // ── Quota / tier ──────────────────────────────────────────────────────────
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  TIER_INSUFFICIENT: 'TIER_INSUFFICIENT',

  // ── Subscription ──────────────────────────────────────────────────────────
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',

  // ── Router ────────────────────────────────────────────────────────────────
  ROUTER_NOT_FOUND: 'ROUTER_NOT_FOUND',
  ROUTER_NOT_READY: 'ROUTER_NOT_READY',
  ROUTER_NOT_CONFIGURED: 'ROUTER_NOT_CONFIGURED',
  ROUTER_UNREACHABLE: 'ROUTER_UNREACHABLE',
  ROUTER_QUOTA_EXCEEDED: 'ROUTER_QUOTA_EXCEEDED',
  ROUTER_LIMIT_REACHED: 'ROUTER_LIMIT_REACHED',

  // ── Voucher ───────────────────────────────────────────────────────────────
  VOUCHER_NOT_FOUND: 'VOUCHER_NOT_FOUND',
  VOUCHER_LIMIT_REACHED: 'VOUCHER_LIMIT_REACHED',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  USERNAME_GENERATION_FAILED: 'USERNAME_GENERATION_FAILED',

  // ── Profile ───────────────────────────────────────────────────────────────
  PROFILE_NOT_FOUND: 'PROFILE_NOT_FOUND',
  PROFILE_DUPLICATE: 'PROFILE_DUPLICATE',
  PROFILE_IN_USE: 'PROFILE_IN_USE',

  // ── Session ───────────────────────────────────────────────────────────────
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',

  // ── Notification ──────────────────────────────────────────────────────────
  NOTIFICATION_NOT_FOUND: 'NOTIFICATION_NOT_FOUND',

  // ── Support ───────────────────────────────────────────────────────────────
  SUPPORT_MESSAGE_NOT_FOUND: 'SUPPORT_MESSAGE_NOT_FOUND',

  // ── Payment ───────────────────────────────────────────────────────────────
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  PAYMENT_ALREADY_REVIEWED: 'PAYMENT_ALREADY_REVIEWED',
  PAYMENT_NO_RECEIPT: 'PAYMENT_NO_RECEIPT',
  PAYMENT_UPLOAD_FAILED: 'PAYMENT_UPLOAD_FAILED',

  // ── Plan (admin) ──────────────────────────────────────────────────────────
  PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
  PLAN_HAS_SUBSCRIPTIONS: 'PLAN_HAS_SUBSCRIPTIONS',

  // ── Admin guards ──────────────────────────────────────────────────────────
  ADMIN_NOT_FOUND: 'ADMIN_NOT_FOUND',
  CANNOT_MODIFY_SELF: 'CANNOT_MODIFY_SELF',
  CANNOT_DELETE_SELF: 'CANNOT_DELETE_SELF',
  CANNOT_MODIFY_ADMIN: 'CANNOT_MODIFY_ADMIN',
  LAST_ADMIN: 'LAST_ADMIN',
  USER_NOT_FOUND: 'USER_NOT_FOUND',

  // ── Report ────────────────────────────────────────────────────────────────
  INVALID_REPORT_TYPE: 'INVALID_REPORT_TYPE',

  // ── Template ──────────────────────────────────────────────────────────────
  TEMPLATE_NOT_FOUND: 'TEMPLATE_NOT_FOUND',
  EMAIL_TEMPLATE_NOT_FOUND: 'EMAIL_TEMPLATE_NOT_FOUND',

  // ── Generic ───────────────────────────────────────────────────────────────
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
