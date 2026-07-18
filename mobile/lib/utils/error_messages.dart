import 'dart:io';

import 'package:dio/dio.dart';

/// Maps any exception to a display string that is safe to show in the UI.
///
/// Rules (in priority order):
/// 1. If the error is a [DioException] whose response body has a nested
///    `error.code` (SCREAMING_SNAKE_CASE), and that code is in the known-codes
///    table, return the matching `error.<CODE>` i18n key.
/// 2. If the body has a nested `error.message` string, return it directly —
///    it is a backend-provided human message.
/// 3. If the body has a flat `message` string, return that.
/// 4. Otherwise switch on [DioExceptionType] and return an i18n key from the
///    `error.*` namespace.  The caller is expected to resolve the key via
///    `context.trOrRaw(value)`.
/// 5. Any non-DioException falls through to `"error.unknown"`.
///
/// This function NEVER returns a raw [DioException.message] or
/// [error.toString()] to the UI.
String errorToDisplay(Object error) {
  if (error is DioException) {
    // ── 1 + 2 + 3: try to extract code / message from response body ─────────
    final data = error.response?.data;
    if (data is Map<String, dynamic>) {
      final errorObj = data['error'];
      if (errorObj is Map<String, dynamic>) {
        // 1. Machine-readable code → mapped i18n key (takes precedence)
        final code = errorObj['code'];
        if (code is String && code.trim().isNotEmpty) {
          final key = _codeToKey[code];
          if (key != null) return key;
        }
        // 2. Human message from the backend
        final msg = errorObj['message'];
        if (msg is String && msg.trim().isNotEmpty) return msg;
      }
      // 3. Flat message field
      final flatMsg = data['message'];
      if (flatMsg is String && flatMsg.trim().isNotEmpty) return flatMsg;
    }

    // ── 4: map Dio-level error type to i18n key ───────────────────────────
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return 'error.timeout';
      case DioExceptionType.connectionError:
        return 'error.network';
      case DioExceptionType.badCertificate:
        return 'error.security';
      case DioExceptionType.badResponse:
        return _statusKey(error.response?.statusCode);
      case DioExceptionType.cancel:
        return 'error.unknown';
      case DioExceptionType.unknown:
        return error.error is SocketException ? 'error.network' : 'error.unknown';
    }
  }

  // ── 5: non-Dio ────────────────────────────────────────────────────────
  return 'error.unknown';
}

/// True only when the server authoritatively rejected our credentials with
/// HTTP 401 — the refresh endpoint's invalid/expired-token signal. A 403 is
/// deliberately excluded: the app uses it for paywall / authorization, not
/// session-end. Network/transport failures (no HTTP response) return false.
bool isAuthRejection(Object error) =>
    error is DioException && error.response?.statusCode == 401;

/// Maps an HTTP status code to the matching i18n error key.
String _statusKey(int? status) {
  switch (status) {
    case 401:
      return 'error.unauthorized';
    case 403:
      return 'error.forbidden';
    case 404:
      return 'error.notFound';
    case 409:
      return 'error.conflict';
    case 429:
      return 'error.rateLimited';
    case 500:
    case 502:
    case 503:
    case 504:
      return 'error.server';
    default:
      return 'error.unknown';
  }
}

/// Mapping from backend SCREAMING_SNAKE_CASE error codes to `error.*` i18n keys.
///
/// Keys must have matching entries in [AppLocalizations._en] and [_ar].
/// For unknown codes the function falls back to the backend's human message.
const _codeToKey = <String, String>{
  'VALIDATION_ERROR': 'error.VALIDATION_ERROR',
  'INVALID_CREDENTIALS': 'error.INVALID_CREDENTIALS',
  'EMAIL_NOT_VERIFIED': 'error.EMAIL_NOT_VERIFIED',
  'EMAIL_EXISTS': 'error.EMAIL_EXISTS',
  'OTP_INVALID': 'error.OTP_INVALID',
  'QUOTA_EXCEEDED': 'error.QUOTA_EXCEEDED',
  'SUBSCRIPTION_REQUIRED': 'error.SUBSCRIPTION_REQUIRED',
  'SUBSCRIPTION_EXPIRED': 'error.SUBSCRIPTION_EXPIRED',
  'ROUTER_LIMIT_REACHED': 'error.ROUTER_LIMIT_REACHED',
  'ROUTER_NOT_FOUND': 'error.ROUTER_NOT_FOUND',
  'ROUTER_UNREACHABLE': 'error.ROUTER_UNREACHABLE',
  'VOUCHER_NOT_FOUND': 'error.VOUCHER_NOT_FOUND',
  'TIER_INSUFFICIENT': 'error.TIER_INSUFFICIENT',
  'INVALID_CURSOR': 'error.INVALID_CURSOR',
  'INTERNAL_ERROR': 'error.INTERNAL_ERROR',
};
