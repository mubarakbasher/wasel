import 'dart:io';

import 'package:dio/dio.dart';

/// Maps any exception to a display string that is safe to show in the UI.
///
/// Rules (in priority order):
/// 1. If the error is a [DioException] whose response body is a Map with a
///    nested `error.message` string, return that string directly — it is a
///    backend-provided human message and should be surfaced as-is.
/// 2. If the body has a flat `message` string, return that.
/// 3. Otherwise switch on [DioExceptionType] and return an i18n key from the
///    `error.*` namespace.  The caller is expected to resolve the key via
///    `context.trOrRaw(value)`.
/// 4. Any non-DioException falls through to `"error.unknown"`.
///
/// This function NEVER returns a raw [DioException.message] or
/// [error.toString()] to the UI.
String errorToDisplay(Object error) {
  if (error is DioException) {
    // ── 1 + 2: try to extract a backend-provided human message ────────────
    final data = error.response?.data;
    if (data is Map<String, dynamic>) {
      final errorObj = data['error'];
      if (errorObj is Map<String, dynamic>) {
        final msg = errorObj['message'];
        if (msg is String && msg.trim().isNotEmpty) return msg;
      }
      final flatMsg = data['message'];
      if (flatMsg is String && flatMsg.trim().isNotEmpty) return flatMsg;
    }

    // ── 3: map Dio-level error type to i18n key ───────────────────────────
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

  // ── 4: non-Dio ────────────────────────────────────────────────────────
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
