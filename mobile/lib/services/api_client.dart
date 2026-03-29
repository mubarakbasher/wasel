import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import 'secure_storage.dart';

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
    final baseUrl = kDebugMode
        ? 'http://10.0.2.2:3000/api/v1' // Android emulator → host machine
        : 'https://api.wasel.app/api/v1';

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

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: _onRequest,
      onError: _onError,
    ));

    if (kDebugMode) {
      _dio.interceptors.add(LogInterceptor(
        requestBody: true,
        responseBody: true,
        logPrint: (obj) => debugPrint(obj.toString()),
      ));
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
    if (failedRequest.path.contains('/auth/refresh')) {
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
