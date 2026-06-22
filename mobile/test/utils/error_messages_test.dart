import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/utils/error_messages.dart';

// Helper: build a minimal DioException for a given type.
DioException _dio({
  DioExceptionType type = DioExceptionType.unknown,
  int? statusCode,
  dynamic data,
  String? message,
  Object? error,
}) {
  Response<dynamic>? response;
  if (statusCode != null || data != null) {
    response = Response(
      requestOptions: RequestOptions(path: '/x'),
      statusCode: statusCode,
      data: data,
    );
  }
  return DioException(
    requestOptions: RequestOptions(path: '/x'),
    type: type,
    response: response,
    message: message,
    error: error,
  );
}

void main() {
  // ── Timeout variants ─────────────────────────────────────────────────────
  group('timeout types return error.timeout', () {
    test('connectionTimeout', () {
      expect(
        errorToDisplay(_dio(type: DioExceptionType.connectionTimeout)),
        'error.timeout',
      );
    });

    test('sendTimeout', () {
      expect(
        errorToDisplay(_dio(type: DioExceptionType.sendTimeout)),
        'error.timeout',
      );
    });

    test('receiveTimeout', () {
      expect(
        errorToDisplay(_dio(type: DioExceptionType.receiveTimeout)),
        'error.timeout',
      );
    });
  });

  // ── Network / certificate ────────────────────────────────────────────────
  test('connectionError returns error.network', () {
    expect(
      errorToDisplay(_dio(type: DioExceptionType.connectionError)),
      'error.network',
    );
  });

  test('badCertificate returns error.security', () {
    expect(
      errorToDisplay(_dio(type: DioExceptionType.badCertificate)),
      'error.security',
    );
  });

  // ── HTTP status codes ────────────────────────────────────────────────────
  group('badResponse status codes', () {
    void expectStatus(int status, String key) {
      test('$status => $key', () {
        expect(
          errorToDisplay(_dio(
            type: DioExceptionType.badResponse,
            statusCode: status,
          )),
          key,
        );
      });
    }

    expectStatus(401, 'error.unauthorized');
    expectStatus(403, 'error.forbidden');
    expectStatus(404, 'error.notFound');
    expectStatus(409, 'error.conflict');
    expectStatus(429, 'error.rateLimited');
    expectStatus(500, 'error.server');
    expectStatus(503, 'error.server');
  });

  // ── Backend message extraction ───────────────────────────────────────────
  group('badResponse with backend message body', () {
    test('nested error.message is returned as literal', () {
      final result = errorToDisplay(_dio(
        type: DioExceptionType.badResponse,
        statusCode: 409,
        data: {
          'error': {'message': 'Email already registered'},
        },
      ));
      expect(result, 'Email already registered');
    });

    test('flat message field is returned as literal', () {
      final result = errorToDisplay(_dio(
        type: DioExceptionType.badResponse,
        statusCode: 400,
        data: {'message': 'Bad request'},
      ));
      expect(result, 'Bad request');
    });
  });

  // ── unknown type with SocketException ────────────────────────────────────
  test('unknown type with SocketException returns error.network', () {
    expect(
      errorToDisplay(_dio(
        type: DioExceptionType.unknown,
        error: const SocketException('Connection refused'),
      )),
      'error.network',
    );
  });

  // ── unknown type without SocketException ─────────────────────────────────
  test('unknown type with non-socket error returns error.unknown', () {
    expect(
      errorToDisplay(_dio(
        type: DioExceptionType.unknown,
        error: Exception('some other error'),
      )),
      'error.unknown',
    );
  });

  // ── Non-Dio exceptions ───────────────────────────────────────────────────
  group('non-DioException inputs', () {
    test('plain Exception returns error.unknown', () {
      expect(errorToDisplay(Exception('boom')), 'error.unknown');
    });

    test('plain String returns error.unknown', () {
      expect(errorToDisplay('something went wrong'), 'error.unknown');
    });
  });

  // ── isAuthRejection ───────────────────────────────────────────────────────
  group('isAuthRejection', () {
    // 401 is an authoritative credential rejection.
    test('DioException with statusCode 401 => true', () {
      expect(
        isAuthRejection(_dio(
          type: DioExceptionType.badResponse,
          statusCode: 401,
        )),
        isTrue,
      );
    });

    // 403 is NOT a session-end signal — the app uses it for paywall /
    // authorization, so isAuthRejection must exclude it.
    test('DioException with statusCode 403 => false', () {
      expect(
        isAuthRejection(_dio(
          type: DioExceptionType.badResponse,
          statusCode: 403,
        )),
        isFalse,
      );
    });

    // Transport errors have no HTTP response — should NOT be treated as auth
    // rejections so the caller does not wipe the session on a network blip.
    test('DioException connectionTimeout (response null) => false', () {
      expect(
        isAuthRejection(_dio(type: DioExceptionType.connectionTimeout)),
        isFalse,
      );
    });

    test('DioException receiveTimeout (response null) => false', () {
      expect(
        isAuthRejection(_dio(type: DioExceptionType.receiveTimeout)),
        isFalse,
      );
    });

    test('DioException sendTimeout (response null) => false', () {
      expect(
        isAuthRejection(_dio(type: DioExceptionType.sendTimeout)),
        isFalse,
      );
    });

    test('DioException connectionError (response null) => false', () {
      expect(
        isAuthRejection(_dio(type: DioExceptionType.connectionError)),
        isFalse,
      );
    });

    // A 500 from the server is a server error, not a credentials rejection.
    test('DioException with statusCode 500 => false', () {
      expect(
        isAuthRejection(_dio(
          type: DioExceptionType.badResponse,
          statusCode: 500,
        )),
        isFalse,
      );
    });

    // Non-Dio objects must return false — the function must not throw.
    test('plain Exception => false', () {
      expect(isAuthRejection(Exception('network down')), isFalse);
    });

    test('plain String => false', () {
      expect(isAuthRejection('something went wrong'), isFalse);
    });
  });

  // ── REGRESSION: verbose Dio timeout message must not leak ────────────────
  group('REGRESSION – verbose Dio timeout message is suppressed', () {
    const verboseMessage =
        'The request connection took longer than 0:00:15.000000 and it was aborted. '
        'To get rid of this exception, try raising the RequestOptions.connectTimeout '
        'above the duration of 0:00:15.000000 or improve the response time of the server.';

    test('connectionTimeout with verbose message returns error.timeout', () {
      final result = errorToDisplay(_dio(
        type: DioExceptionType.connectionTimeout,
        message: verboseMessage,
      ));
      expect(result, 'error.timeout');
    });

    test('result does not contain "0:00:15"', () {
      final result = errorToDisplay(_dio(
        type: DioExceptionType.connectionTimeout,
        message: verboseMessage,
      ));
      expect(result.contains('0:00:15'), isFalse,
          reason: 'Raw Dio duration must never reach the UI');
    });

    test('result does not contain "connectTimeout"', () {
      final result = errorToDisplay(_dio(
        type: DioExceptionType.connectionTimeout,
        message: verboseMessage,
      ));
      expect(result.contains('connectTimeout'), isFalse,
          reason: 'Raw Dio internal term must never reach the UI');
    });
  });
}
