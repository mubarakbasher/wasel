import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart' show sha256;
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:flutter/foundation.dart';

import 'secure_storage.dart';

// ---------------------------------------------------------------------------
// Certificate pinning — SPKI SHA-256 pins for api.wa-sel.com
//
// Primary holds the current leaf-cert pin. Backup is intentionally identical
// to primary until a standby cert or intermediate-CA pin is provisioned; with
// matching pins, a compromised primary requires an app update to recover.
//
// To refresh either pin:
//   echo | openssl s_client -connect api.wa-sel.com:443 -servername api.wa-sel.com 2>/dev/null \
//     | openssl x509 -pubkey -noout \
//     | openssl pkey -pubin -outform der \
//     | openssl dgst -sha256 -binary | openssl enc -base64
// ---------------------------------------------------------------------------
const _kPinPrimary = 'Mh+xVjeEin+YcN+tBVkpv5L9gicHLflwqHGPEb2VAWA=';
const _kPinBackup = 'Mh+xVjeEin+YcN+tBVkpv5L9gicHLflwqHGPEb2VAWA=';

/// Fields whose values are always replaced with '[REDACTED]' in logs.
const _kRedactedFields = {
  'password',
  'otp',
  'refresh_token',
  'refreshToken',
  'access_token',
  'accessToken',
  'authorization',
  'Authorization',
};

class ApiClient {
  late final Dio _dio;
  final SecureStorageService _storage = SecureStorageService();

  bool _isRefreshing = false;
  final List<Completer<String>> _refreshQueue = [];

  /// Callback invoked when token refresh fails and the user must re-login.
  /// Set this from your auth provider / navigation layer.
  VoidCallback? onSessionExpired;

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------

  static final ApiClient _instance = ApiClient._internal();
  factory ApiClient() => _instance;

  ApiClient._internal() {
    const baseUrl = 'https://api.wa-sel.com/api/v1';

    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
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
      _dio.httpClientAdapter = IOHttpClientAdapter(
        createHttpClient: () {
          final client = HttpClient();
          client.badCertificateCallback = (cert, host, port) {
            // Compute SPKI SHA-256 for the presented certificate.
            final spkiDer = cert.der;
            final digest = sha256.convert(spkiDer);
            final pin = base64.encode(digest.bytes);
            final allowed = pin == _kPinPrimary || pin == _kPinBackup;
            if (!allowed) {
              debugPrint('[CertPin] REJECTED pin=$pin host=$host');
            }
            return allowed;
          };
          return client;
        },
      );
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

  /// Handle 401 responses by attempting a silent token refresh.
  ///
  /// Strategy:
  /// - If a refresh is already in progress, queue the failed request behind a
  ///   [Completer] so it is retried once the new token is available.
  /// - Otherwise, kick off the refresh flow. On success, retry the original
  ///   request and drain the queue. On failure, clear tokens and notify the
  ///   app so it can navigate to the login screen.
  Future<void> _onError(
    DioException error,
    ErrorInterceptorHandler handler,
  ) async {
    if (error.response?.statusCode != 401) {
      return handler.next(error);
    }

    final failedRequest = error.requestOptions;

    // Never attempt to refresh when the refresh endpoint itself fails.
    // Use endsWith to avoid matching variant paths like /auth/refresh-extra.
    if (failedRequest.path.endsWith('/auth/refresh')) {
      return handler.next(error);
    }

    // If another refresh is already in flight, wait for it.
    if (_isRefreshing) {
      try {
        final completer = Completer<String>();
        _refreshQueue.add(completer);
        final newToken = await completer.future;
        failedRequest.headers['Authorization'] = 'Bearer $newToken';
        final retryResponse = await _dio.fetch(failedRequest);
        return handler.resolve(retryResponse);
      } catch (_) {
        return handler.next(error);
      }
    }

    _isRefreshing = true;

    try {
      final refreshToken = await _storage.getRefreshToken();
      if (refreshToken == null) {
        throw DioException(
          requestOptions: failedRequest,
          message: 'No refresh token available',
        );
      }

      // Use a fresh Dio instance so the interceptor doesn't attach the
      // expired access token or trigger another refresh loop.
      final refreshDio = Dio(BaseOptions(
        baseUrl: _dio.options.baseUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 10),
        headers: {'Content-Type': 'application/json'},
      ));

      final response = await refreshDio.post(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
      );

      final newAccessToken = response.data['data']['accessToken'] as String;
      final newRefreshToken = response.data['data']['refreshToken'] as String;

      // Persist the rotated token pair.
      await _storage.setTokens(newAccessToken, newRefreshToken);

      // Drain the queue — unblock every waiting request.
      for (final completer in _refreshQueue) {
        completer.complete(newAccessToken);
      }
      _refreshQueue.clear();

      // Retry the original request with the fresh token.
      failedRequest.headers['Authorization'] = 'Bearer $newAccessToken';
      final retryResponse = await _dio.fetch(failedRequest);
      return handler.resolve(retryResponse);
    } catch (refreshError) {
      // Refresh failed — reject all queued requests.
      for (final completer in _refreshQueue) {
        completer.completeError(refreshError);
      }
      _refreshQueue.clear();

      await _storage.clearAll();
      onSessionExpired?.call();

      return handler.next(error);
    } finally {
      _isRefreshing = false;
    }
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
