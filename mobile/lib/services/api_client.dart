import 'dart:convert';

import 'package:asn1lib/asn1lib.dart';
import 'package:crypto/crypto.dart' show sha256;
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../config/app_config.dart';
import '../navigation/app_router.dart' show appNavigatorKey;
import '../utils/error_messages.dart';
import 'secure_storage.dart';

// ---------------------------------------------------------------------------
// Certificate pinning — SPKI SHA-256 pins for api.wa-sel.com
//
// Primary: pin of the current leaf certificate. Rotates every ~90 days when
// the leaf is renewed.
// Backup: pin of the issuing intermediate CA. Stable for years; survives
// leaf rotations and lets us recover from a compromised primary without
// shipping an app update.
//
// To refresh the primary (leaf) pin:
//   echo | openssl s_client -connect api.wa-sel.com:443 -servername api.wa-sel.com 2>/dev/null \
//     | openssl x509 -pubkey -noout \
//     | openssl pkey -pubin -outform der \
//     | openssl dgst -sha256 -binary | openssl enc -base64
//
// To refresh the backup (intermediate CA) pin — only when the CA changes:
//   echo | openssl s_client -servername api.wa-sel.com -connect api.wa-sel.com:443 -showcerts 2>/dev/null \
//     | awk 'BEGIN{c=0} /BEGIN CERTIFICATE/{c++} c==2,/END CERTIFICATE/' \
//     | openssl x509 -pubkey -noout \
//     | openssl pkey -pubin -outform der \
//     | openssl dgst -sha256 -binary | openssl enc -base64
// ---------------------------------------------------------------------------
const _kPinPrimary = 'Mh+xVjeEin+YcN+tBVkpv5L9gicHLflwqHGPEb2VAWA=';
const _kPinBackup = 'iFvwVyJSxnQdyaUvUERIf+8qk7gRze3612JMwoO3zdU=';

/// Fields whose values are always replaced with '[REDACTED]' in logs.
const _kRedactedFields = {
  'password',
  'newPassword',
  'currentPassword',
  'otp',
  'refresh_token',
  'refreshToken',
  'access_token',
  'accessToken',
  'authorization',
  'Authorization',
  // Router API credential + server-generated setup scripts (WireGuard private
  // key, RADIUS secret, admin password live inside these).
  'apiPass',
  'command',
  'commands',
  'setupGuide',
  'token',
};

class ApiClient {
  late final Dio _dio;
  final SecureStorageService _storage = SecureStorageService();

  /// Single-flight token refresh. Concurrent 401s all await this same future;
  /// late joiners never queue behind a drained list, so none can hang.
  Future<String>? _refreshFuture;

  /// After a non-auth refresh failure (e.g. a malformed 2xx from a captive
  /// portal) we keep the tokens but back off briefly so a burst of 401s can't
  /// trigger a per-request refresh storm.
  DateTime? _refreshBackoffUntil;

  /// Debounce for the paywall redirect so concurrent 403s don't stack pushes.
  DateTime? _lastPaywallRedirect;

  /// Callback invoked when token refresh fails and the user must re-login.
  /// Set this from your auth provider / navigation layer.
  VoidCallback? onSessionExpired;

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------

  static final ApiClient _instance = ApiClient._internal();
  factory ApiClient() => _instance;

  ApiClient._internal() {
    _dio = Dio(BaseOptions(
      baseUrl: AppConfig.apiBaseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
      sendTimeout: const Duration(seconds: 15),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ));

    // Certificate pinning — enforced only in release mode so that local dev
    // against http://localhost:3000 continues to work without modification.
    if (!kDebugMode) {
      _dio.httpClientAdapter = _pinnedAdapter();
    }

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: _onRequest,
      onError: _onError,
    ));

    if (kDebugMode) {
      _dio.interceptors.add(_RedactedLogInterceptor());
    }
  }

  /// Expose the underlying Dio instance for direct use when needed.
  Dio get dio => _dio;

  // ---------------------------------------------------------------------------
  // Convenience HTTP methods
  // ---------------------------------------------------------------------------

  Future<Response<T>> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
    CancelToken? cancelToken,
  }) =>
      _dio.get<T>(
        path,
        queryParameters: queryParameters,
        options: options,
        cancelToken: cancelToken,
      );

  Future<Response<T>> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    CancelToken? cancelToken,
  }) =>
      _dio.post<T>(
        path,
        data: data,
        queryParameters: queryParameters,
        options: options,
        cancelToken: cancelToken,
      );

  Future<Response<T>> put<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    CancelToken? cancelToken,
  }) =>
      _dio.put<T>(
        path,
        data: data,
        queryParameters: queryParameters,
        options: options,
        cancelToken: cancelToken,
      );

  Future<Response<T>> patch<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    CancelToken? cancelToken,
  }) =>
      _dio.patch<T>(
        path,
        data: data,
        queryParameters: queryParameters,
        options: options,
        cancelToken: cancelToken,
      );

  Future<Response<T>> delete<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    CancelToken? cancelToken,
  }) =>
      _dio.delete<T>(
        path,
        data: data,
        queryParameters: queryParameters,
        options: options,
        cancelToken: cancelToken,
      );

  Future<Response<T>> postMultipart<T>(
    String path,
    FormData data, {
    CancelToken? cancelToken,
  }) =>
      _dio.post<T>(
        path,
        data: data,
        options: Options(contentType: 'multipart/form-data'),
        cancelToken: cancelToken,
      );

  // ---------------------------------------------------------------------------
  // Interceptors
  // ---------------------------------------------------------------------------

  /// Attach the access token to every outgoing request.
  Future<void> _onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await _storage.getAccessToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  // ---------------------------------------------------------------------------
  // 403 paywall codes that trigger a redirect to /subscription.
  // ---------------------------------------------------------------------------
  static const _kPaywallCodes = {
    'SUBSCRIPTION_REQUIRED',
    'SUBSCRIPTION_EXPIRED',
    'QUOTA_EXCEEDED',
    'ROUTER_LIMIT_REACHED',
  };

  /// Handle 403 paywall responses by showing a SnackBar and navigating to
  /// /subscription. The error is still forwarded to the caller so that
  /// providers can set their own error state.
  void _handlePaywall(DioException error) {
    try {
      final data = error.response?.data;
      if (data is! Map) return;

      final errorObj = data['error'];
      if (errorObj is! Map) return;

      final code = errorObj['code'];
      if (!_kPaywallCodes.contains(code)) return;

      final navigatorState = appNavigatorKey.currentState;
      if (navigatorState == null) return;

      // Skip the redirect on unauthenticated routes (a stale in-flight 403 or a
      // forged one must not bounce the login/splash screens to /subscription)
      // and when already on /subscription (avoids redirect loops).
      final currentRoute = GoRouter.of(navigatorState.context)
          .routerDelegate
          .currentConfiguration
          .fullPath;
      const unauthenticatedRoutes = {
        '/login',
        '/register',
        '/splash',
        '/verify-email',
        '/forgot-password',
        '/reset-password',
      };
      if (currentRoute.startsWith('/subscription')) return;
      if (unauthenticatedRoutes.any(currentRoute.startsWith)) return;

      // Debounce: concurrent 403s must not stack multiple pushes.
      final now = DateTime.now();
      final last = _lastPaywallRedirect;
      if (last != null && now.difference(last) < const Duration(seconds: 3)) {
        return;
      }
      _lastPaywallRedirect = now;

      // Derive a human-friendly message from the code.
      final String message;
      switch (code) {
        case 'SUBSCRIPTION_REQUIRED':
          message = 'A subscription is required to do that.';
          break;
        case 'SUBSCRIPTION_EXPIRED':
          message = 'Your subscription has expired. Please renew to continue.';
          break;
        case 'QUOTA_EXCEEDED':
          message = 'You have reached your voucher quota for this plan.';
          break;
        case 'ROUTER_LIMIT_REACHED':
          message = 'You have reached the router limit for your plan.';
          break;
        default:
          message = 'Subscription required.';
      }

      ScaffoldMessenger.maybeOf(navigatorState.context)?.showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
      );

      GoRouter.of(navigatorState.context).push('/subscription');
    } catch (_) {
      // Never crash the caller — paywall redirect is best-effort.
    }
  }

  /// Handle 401 responses by attempting a single-flight silent token refresh.
  ///
  /// Every concurrent 401 awaits the SAME [_refreshFuture]; late joiners never
  /// queue behind a drained list, so none can hang. On success each caller
  /// retries its original request with the new token. On an auth rejection the
  /// session ends; a transient/malformed failure keeps the tokens and backs
  /// off briefly.
  Future<void> _onError(
    DioException error,
    ErrorInterceptorHandler handler,
  ) async {
    // Handle 403 paywall codes — fire-and-forget UX redirect.
    if (error.response?.statusCode == 403) {
      _handlePaywall(error);
      return handler.next(error);
    }

    if (error.response?.statusCode != 401) {
      return handler.next(error);
    }

    final failedRequest = error.requestOptions;

    // Never attempt to refresh when the refresh endpoint itself fails.
    // Use endsWith to avoid matching variant paths like /auth/refresh-extra.
    if (failedRequest.path.endsWith('/auth/refresh')) {
      return handler.next(error);
    }

    // Back off after a recent non-auth refresh failure so a burst of 401s
    // can't trigger a per-request refresh storm.
    final backoff = _refreshBackoffUntil;
    if (backoff != null && DateTime.now().isBefore(backoff)) {
      return handler.next(error);
    }

    try {
      // Join the in-flight refresh, or start a new one. `??=` is atomic here
      // (no await between read and assign on a single isolate).
      final newToken = await (_refreshFuture ??= _performRefresh(error));
      failedRequest.headers['Authorization'] = 'Bearer $newToken';
      // dio finalizes FormData on send, so the original instance can't be
      // re-sent — clone it before retrying a multipart request.
      if (failedRequest.data is FormData) {
        failedRequest.data = (failedRequest.data as FormData).clone();
      }
      final retryResponse = await _dio.fetch(failedRequest);
      return handler.resolve(retryResponse);
    } catch (_) {
      return handler.next(error);
    }
  }

  /// Performs the actual refresh. Exactly one runs at a time (guarded by
  /// [_refreshFuture]); clears the future in `finally` so the next 401 starts
  /// fresh rather than awaiting a settled future.
  Future<String> _performRefresh(DioException error) async {
    try {
      final refreshToken = await _storage.getRefreshToken();
      if (refreshToken == null) {
        await _storage.clearSession();
        onSessionExpired?.call();
        throw error;
      }

      // Fresh Dio so the interceptor doesn't attach the expired token or
      // recurse — but keep the SAME certificate pinning as the main client.
      final refreshDio = Dio(BaseOptions(
        baseUrl: _dio.options.baseUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 10),
        headers: {'Content-Type': 'application/json'},
      ));
      if (!kDebugMode) {
        refreshDio.httpClientAdapter = _pinnedAdapter();
      }

      final response = await refreshDio.post(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
      );

      // Validate the shape explicitly — a captive portal / proxy can return a
      // 2xx with an unexpected body, and a blind cast would throw a TypeError
      // that isAuthRejection() misclassifies as non-auth (keeping dead tokens).
      final data = response.data;
      final inner = data is Map ? data['data'] : null;
      final newAccessToken = inner is Map ? inner['accessToken'] : null;
      final newRefreshToken = inner is Map ? inner['refreshToken'] : null;
      if (newAccessToken is! String ||
          newAccessToken.isEmpty ||
          newRefreshToken is! String ||
          newRefreshToken.isEmpty) {
        throw StateError('Malformed /auth/refresh response');
      }

      await _storage.setTokens(newAccessToken, newRefreshToken);
      _refreshBackoffUntil = null;
      return newAccessToken;
    } catch (e) {
      if (isAuthRejection(e)) {
        await _storage.clearSession();
        onSessionExpired?.call();
      } else {
        // Transient/malformed: keep tokens, but don't hammer refresh.
        _refreshBackoffUntil =
            DateTime.now().add(const Duration(seconds: 10));
      }
      rethrow;
    } finally {
      _refreshFuture = null;
    }
  }

  /// Builds an [IOHttpClientAdapter] that pins the server certificate by its
  /// SPKI SHA-256. Unlike badCertificateCallback (which only fires when default
  /// chain validation FAILS), [validateCertificate] runs on EVERY established
  /// TLS connection, so a CA-valid MITM certificate is still checked against
  /// the pins.
  ///
  /// The pins are the SHA-256 of the SubjectPublicKeyInfo (SPKI) — see the
  /// openssl recipe at the top of this file. They MUST be verified against the
  /// live api.wa-sel.com certificate on staging before any prod promotion.
  IOHttpClientAdapter _pinnedAdapter() {
    return IOHttpClientAdapter(
      validateCertificate: (cert, host, port) {
        if (cert == null) return false;
        final spki = _spkiSha256(cert.der);
        if (spki == null) {
          debugPrint('[CertPin] could not extract SPKI for $host');
          return false;
        }
        final allowed = spki == _kPinPrimary || spki == _kPinBackup;
        if (!allowed) {
          debugPrint('[CertPin] REJECTED spki=$spki host=$host');
        }
        return allowed;
      },
    );
  }

  /// Extracts the SubjectPublicKeyInfo from a certificate DER and returns its
  /// base64 SHA-256. The SPKI is the only element of TBSCertificate shaped
  /// `SEQUENCE { AlgorithmIdentifier(SEQUENCE), subjectPublicKey(BIT STRING) }`,
  /// so we locate it by that shape (robust to the optional version tag offset).
  static String? _spkiSha256(Uint8List certDer) {
    try {
      final cert = ASN1Parser(certDer).nextObject() as ASN1Sequence;
      final tbs = cert.elements[0] as ASN1Sequence;
      for (final el in tbs.elements) {
        if (el is ASN1Sequence &&
            el.elements.length == 2 &&
            el.elements[0] is ASN1Sequence &&
            el.elements[1] is ASN1BitString) {
          return base64.encode(sha256.convert(el.encodedBytes).bytes);
        }
      }
    } catch (_) {
      // Fall through to null -> connection rejected (fail closed).
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Redacted log interceptor
//
// Logs method, path, status and duration. Strips the Authorization header
// and replaces sensitive body fields with '[REDACTED]'.
// ---------------------------------------------------------------------------
class _RedactedLogInterceptor extends Interceptor {
  final _stopwatches = <String, Stopwatch>{};

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final key = '${options.method}:${options.path}:${DateTime.now().millisecondsSinceEpoch}';
    options.extra['_logKey'] = key;
    _stopwatches[key] = Stopwatch()..start();

    final safeHeaders = Map<String, dynamic>.from(options.headers);
    safeHeaders.remove('Authorization');
    safeHeaders.remove('authorization');

    debugPrint(
      '[HTTP] --> ${options.method} ${options.path}'
      '\n        Headers: $safeHeaders'
      '\n        Body: ${_redactBody(options.data)}',
    );
    handler.next(options);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    final key = response.requestOptions.extra['_logKey'] as String?;
    final elapsed = key != null ? (_stopwatches.remove(key)?..stop())?.elapsedMilliseconds : null;

    debugPrint(
      '[HTTP] <-- ${response.statusCode} ${response.requestOptions.method} '
      '${response.requestOptions.path}'
      '${elapsed != null ? ' (${elapsed}ms)' : ''}'
      '\n        Body: ${_redactBody(response.data)}',
    );
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final key = err.requestOptions.extra['_logKey'] as String?;
    _stopwatches.remove(key);

    debugPrint(
      '[HTTP] ERR ${err.requestOptions.method} ${err.requestOptions.path}'
      ' — ${err.response?.statusCode} ${err.message}',
    );
    handler.next(err);
  }

  dynamic _redactBody(dynamic body) {
    if (body == null) return null;
    if (body is Map) {
      return body.map((k, v) {
        if (_kRedactedFields.contains(k.toString())) {
          return MapEntry(k, '[REDACTED]');
        }
        if (v is Map || v is List) return MapEntry(k, _redactBody(v));
        return MapEntry(k, v);
      });
    }
    if (body is List) return body.map(_redactBody).toList();
    if (body is String) {
      // Attempt to parse JSON strings so field-level redaction applies.
      try {
        final decoded = jsonDecode(body);
        return _redactBody(decoded);
      } catch (_) {
        return body;
      }
    }
    return body;
  }
}
