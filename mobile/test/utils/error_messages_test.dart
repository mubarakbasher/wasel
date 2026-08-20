import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
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
    // Backend messages are English-only (no Accept-Language on either side), so
    // returning one would show English to an Arabic user. They must never leak.
    test('nested error.message is NOT leaked - falls back to the status key', () {
      final result = errorToDisplay(_dio(
        type: DioExceptionType.badResponse,
        statusCode: 409,
        data: {
          'error': {'message': 'Email already registered'},
        },
      ));
      expect(result, 'error.conflict');
    });

    test('flat message field is NOT leaked - falls back to the status key', () {
      final result = errorToDisplay(_dio(
        type: DioExceptionType.badResponse,
        statusCode: 400,
        data: {'message': 'Bad request'},
      ));
      expect(result, 'error.badRequest');
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

  // ── New backend codes (voucher generation + router provisioning) ──────────
  group('new backend error codes map to i18n keys', () {
    void expectCode(String code, String key) {
      test('$code => $key', () {
        final result = errorToDisplay(_dio(
          type: DioExceptionType.badResponse,
          statusCode: 422,
          data: {
            'error': {'code': code, 'message': 'backend raw message'},
          },
        ));
        expect(result, key,
            reason: 'machine-readable code must take precedence over the '
                'backend human message and map to the correct i18n key');
      });
    }

    expectCode('USERNAME_TAKEN', 'error.USERNAME_TAKEN');
    expectCode('USERNAME_GENERATION_FAILED', 'error.USERNAME_GENERATION_FAILED');
    expectCode('ROUTER_NOT_READY', 'error.ROUTER_NOT_READY');
    expectCode('RATE_LIMIT_EXCEEDED', 'error.RATE_LIMIT_EXCEEDED');
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

  // ── Auth codes that used to leak English (the reported bug) ──────────────
  group('auth error codes derive a localized i18n key', () {
    void expectCode(String code, {int status = 400}) {
      test('$code => error.$code', () {
        final result = errorToDisplay(_dio(
          type: DioExceptionType.badResponse,
          statusCode: status,
          data: {
            'error': {'code': code, 'message': 'backend raw english message'},
          },
        ));
        expect(result, 'error.$code',
            reason: 'the machine-readable code must win over the backend '
                'human message, which is always English');
      });
    }

    expectCode('AUTH_RATE_LIMIT_EXCEEDED', status: 429);
    expectCode('EMAIL_RATE_LIMIT_EXCEEDED', status: 429);
    expectCode('ACCOUNT_LOCKED', status: 423);
    expectCode('ACCOUNT_SUSPENDED', status: 403);
    expectCode('OTP_LOCKED', status: 429);
    expectCode('USER_NOT_FOUND', status: 404);
    expectCode('ALREADY_VERIFIED');
    expectCode('INVALID_PASSWORD', status: 401);
    expectCode('EMAIL_UNCHANGED');
    expectCode('EMAIL_CHANGE_INVALID');
    expectCode('REFRESH_TOKEN_INVALID', status: 401);
    expectCode('REFRESH_TOKEN_REVOKED', status: 401);
    expectCode('AUTH_REQUIRED', status: 401);
    expectCode('TOKEN_INVALID', status: 401);
    expectCode('NOT_FOUND', status: 404);
  });

  // ── Unknown / future codes fall back to a LOCALIZED key, not English ─────
  group('unknown backend code falls back to the status key', () {
    test('unknown code at 429 => error.rateLimited', () {
      expect(
        errorToDisplay(_dio(
          type: DioExceptionType.badResponse,
          statusCode: 429,
          data: {
            'error': {
              'code': 'BRAND_NEW_CODE_2027',
              'message': 'Some English text',
            },
          },
        )),
        'error.rateLimited',
      );
    });

    test('unknown code at 403 => error.forbidden', () {
      expect(
        errorToDisplay(_dio(
          type: DioExceptionType.badResponse,
          statusCode: 403,
          data: {
            'error': {
              'code': 'BRAND_NEW_CODE_2027',
              'message': 'Some English text',
            },
          },
        )),
        'error.forbidden',
      );
    });
  });

  // ── Widened status mapping ───────────────────────────────────────────────
  group('status codes added alongside the fix', () {
    void expectStatusKey(int status, String key) {
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

    expectStatusKey(400, 'error.badRequest');
    expectStatusKey(422, 'error.badRequest');
    expectStatusKey(423, 'error.ACCOUNT_LOCKED');
  });

  // ── INVARIANT: no English can EVER reach the UI ──────────────────────────
  //
  // Every possible input must yield a key that (a) lives in the `error.*`
  // namespace and (b) actually has a translation. This turns "we never show a
  // backend string" from a review convention into a mechanically checked
  // property.
  group('INVARIANT - errorToDisplay always returns a translatable error key', () {
    const englishBody = {
      'error': {'code': 'TOTALLY_UNKNOWN_CODE', 'message': 'Raw English text'},
    };

    final cases = <String, Object>{
      'connectionTimeout': _dio(type: DioExceptionType.connectionTimeout),
      'sendTimeout': _dio(type: DioExceptionType.sendTimeout),
      'receiveTimeout': _dio(type: DioExceptionType.receiveTimeout),
      'connectionError': _dio(type: DioExceptionType.connectionError),
      'badCertificate': _dio(type: DioExceptionType.badCertificate),
      'cancel': _dio(type: DioExceptionType.cancel),
      'unknown': _dio(type: DioExceptionType.unknown),
      'unknown+socket': _dio(
        type: DioExceptionType.unknown,
        error: const SocketException('no route'),
      ),
      for (final s in [400, 401, 403, 404, 409, 422, 423, 429, 500, 503])
        'status $s (no body)':
            _dio(type: DioExceptionType.badResponse, statusCode: s),
      for (final s in [400, 401, 403, 404, 409, 422, 423, 429, 500, 503])
        'status $s (unknown code + english message)': _dio(
          type: DioExceptionType.badResponse,
          statusCode: s,
          data: englishBody,
        ),
      'null body': _dio(type: DioExceptionType.badResponse, statusCode: 500),
      'list body': _dio(
        type: DioExceptionType.badResponse,
        statusCode: 500,
        data: const ['a', 'b'],
      ),
      'string body': _dio(
        type: DioExceptionType.badResponse,
        statusCode: 500,
        data: '<html>gateway error</html>',
      ),
      'Map<dynamic, dynamic> body': _dio(
        type: DioExceptionType.badResponse,
        statusCode: 403,
        data: <dynamic, dynamic>{
          'error': <dynamic, dynamic>{
            'code': 'SUBSCRIPTION_REQUIRED',
            'message': 'A subscription is required.',
          },
        },
      ),
      'empty code': _dio(
        type: DioExceptionType.badResponse,
        statusCode: 409,
        data: {
          'error': {'code': '   ', 'message': 'English'},
        },
      ),
      'plain Exception': Exception('boom'),
      'plain String': 'boom',
    };

    cases.forEach((name, error) {
      test(name, () {
        final result = errorToDisplay(error);
        expect(result, startsWith('error.'),
            reason: 'must be an i18n key, never a display string');
        expect(AppLocalizations.hasTranslationKey(result), isTrue,
            reason: '$result has no entry in _en, so trOrRaw would render the '
                'raw key to the user');
        final ar = AppLocalizations(const Locale('ar'));
        expect(ar.translate(result), isNot(result),
            reason: '$result has no Arabic entry');
      });
    });
  });
}
