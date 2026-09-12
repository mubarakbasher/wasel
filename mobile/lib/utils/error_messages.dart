import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../i18n/app_localizations.dart';

/// Maps any exception to an i18n key that is safe to show in the UI.
///
/// The return value is ALWAYS an `error.*` key — never a backend string, never
/// [DioException.message], never `error.toString()`. Backend API messages are
/// English-only (the app sends no `Accept-Language` and the server reads none),
/// so returning one would show English to an Arabic user.
///
/// Rules (in priority order):
/// 1. [DioException] whose body carries `error.code` → `error.<CODE>`, when that
///    key exists in [AppLocalizations]. Keys are DERIVED from the code, not
///    table-mapped: adding an `error.<CODE>` translation pair is all it takes to
///    support a new backend code.
/// 2. Unknown / future code → falls through to 3. The English text is logged in
///    debug builds only, so an unmapped code stays diagnosable.
/// 3. [DioExceptionType] → an `error.*` key; `badResponse` maps the HTTP status
///    via [_statusKey].
/// 4. Any non-[DioException] → `error.unknown`.
///
/// The caller resolves the key via `context.trOrRaw(value)`.
String errorToDisplay(Object error) {
  if (error is DioException) {
    // ── 1 + 2: derive an i18n key from the backend's machine-readable code ──
    final data = error.response?.data;
    if (data is Map) {
      final errorObj = data['error'];
      if (errorObj is Map) {
        final code = errorObj['code'];
        if (code is String && code.trim().isNotEmpty) {
          final key = 'error.${code.trim()}';
          if (AppLocalizations.hasTranslationKey(key)) return key;

          // Unknown code: log the English so it stays diagnosable, but never
          // render it. The assert body is stripped from release builds.
          assert(() {
            debugPrint(
              '[i18n] Untranslated backend error code "$code" '
              '(HTTP ${error.response?.statusCode}) — '
              'add $key to _en and _ar in app_localizations.dart. '
              'Backend said: ${errorObj['message']}',
            );
            return true;
          }());
        }
      }
    }

    // ── 3: map the Dio-level error type to an i18n key ─────────────────────
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

  // ── 4: non-Dio ──────────────────────────────────────────────────────────
  return 'error.unknown';
}

/// True only when the server authoritatively rejected our credentials with
/// HTTP 401 — the refresh endpoint's invalid/expired-token signal. A 403 is
/// deliberately excluded: the app uses it for paywall / authorization, not
/// session-end. Network/transport failures (no HTTP response) return false.
bool isAuthRejection(Object error) =>
    error is DioException && error.response?.statusCode == 401;

/// Maps an HTTP status code to the matching i18n error key.
///
/// This is the fallback for a response with no code, or a code this build has
/// no translation for — so its coverage is what stops English from leaking.
String _statusKey(int? status) {
  switch (status) {
    case 400:
    case 422:
      return 'error.badRequest';
    case 401:
      return 'error.unauthorized';
    case 403:
      return 'error.forbidden';
    case 404:
      return 'error.notFound';
    case 409:
      return 'error.conflict';
    case 423:
      // 423 is only ever emitted for the login lockout (auth.service.ts).
      return 'error.ACCOUNT_LOCKED';
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
