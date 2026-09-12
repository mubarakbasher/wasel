import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/models/user.dart';
import 'package:wasel/providers/auth_provider.dart';
import 'package:wasel/services/api_client.dart';
import 'package:wasel/services/auth_service.dart';
import 'package:wasel/services/secure_storage.dart';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class MockAuthService extends Mock implements AuthService {}

class MockSecureStorage extends Mock implements SecureStorageService {}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

final _kUser = User(
  id: 'u-1',
  name: 'Ali Wasel',
  email: 'ali@example.com',
  isVerified: true,
);

String _userJson() => jsonEncode(_kUser.toJson());

/// A DioException that represents a transport-layer offline failure.
/// [response] is intentionally null — no HTTP status code is present.
DioException _connectionError() => DioException(
      requestOptions: RequestOptions(path: '/auth/me'),
      type: DioExceptionType.connectionError,
    );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  late MockAuthService svc;
  late MockSecureStorage storage;
  late AuthNotifier notifier;

  setUp(() {
    svc = MockAuthService();
    storage = MockSecureStorage();
    // No Ref passed — _ref is null, so _resetUserScopedProviders is a no-op.
    // ApiClient singleton registers onSessionExpired from the latest notifier.
    notifier = AuthNotifier(authService: svc, storageService: storage);
  });

  tearDown(() {
    // Clear the ApiClient singleton callback so tests don't leak into each
    // other via the shared singleton.
    ApiClient().onSessionExpired = null;
  });

  /// Stubs a successful POST /auth/register call matching any args.
  /// Shared by the `register` and `verifyEmail` groups (both need a
  /// register() call to succeed) to avoid duplicating the same matcher stub.
  void stubRegisterSuccess() {
    when(
      () => svc.register(
        name: any(named: 'name'),
        email: any(named: 'email'),
        phone: any(named: 'phone'),
        password: any(named: 'password'),
        language: any(named: 'language'),
        businessName: any(named: 'businessName'),
      ),
    ).thenAnswer((_) async {});
  }

  group('AuthNotifier.tryRestoreSession — offline resilience', () {
    test(
        'getProfile throws connectionError with cached user '
        '=> isAuthenticated stays true, clearAll NOT called, isLoading false',
        () async {
      // Arrange: tokens exist, cached user is present, network is unreachable.
      when(() => storage.hasTokens()).thenAnswer((_) async => true);
      when(() => storage.getUserData()).thenAnswer((_) async => _userJson());
      when(() => svc.getProfile()).thenThrow(_connectionError());

      // Act
      await notifier.tryRestoreSession();

      // Assert: session must survive a transient offline boot.
      expect(notifier.state.isAuthenticated, isTrue,
          reason: 'offline boot must not log the user out');
      expect(notifier.state.isLoading, isFalse,
          reason: 'spinner must be cleared even on error');
      expect(notifier.state.user?.email, 'ali@example.com',
          reason: 'cached user should be visible while offline');

      // clearAll must NOT have been called — wiping tokens on a network blip
      // would force the user to log in again unnecessarily.
      verifyNever(() => storage.clearAll());
    });

    test(
        'getProfile throws sendTimeout with cached user '
        '=> isAuthenticated stays true, clearAll NOT called',
        () async {
      when(() => storage.hasTokens()).thenAnswer((_) async => true);
      when(() => storage.getUserData()).thenAnswer((_) async => _userJson());
      when(() => svc.getProfile()).thenThrow(DioException(
        requestOptions: RequestOptions(path: '/auth/me'),
        type: DioExceptionType.sendTimeout,
      ));

      await notifier.tryRestoreSession();

      expect(notifier.state.isAuthenticated, isTrue);
      expect(notifier.state.isLoading, isFalse);
      verifyNever(() => storage.clearAll());
    });

    test(
        'no tokens stored => returns immediately, isAuthenticated stays false',
        () async {
      when(() => storage.hasTokens()).thenAnswer((_) async => false);

      await notifier.tryRestoreSession();

      expect(notifier.state.isAuthenticated, isFalse);
      expect(notifier.state.isLoading, isFalse);
      verifyNever(() => svc.getProfile());
    });

    test(
        'getProfile succeeds => isAuthenticated true, user hydrated, '
        'setUserData called with fresh JSON',
        () async {
      when(() => storage.hasTokens()).thenAnswer((_) async => true);
      when(() => storage.getUserData()).thenAnswer((_) async => null);
      when(() => svc.getProfile()).thenAnswer((_) async => _kUser);
      when(() => storage.setUserData(any())).thenAnswer((_) async {});

      await notifier.tryRestoreSession();

      expect(notifier.state.isAuthenticated, isTrue);
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.user?.id, 'u-1');
      verify(() => storage.setUserData(any())).called(1);
    });
  });

  // -------------------------------------------------------------------------
  // isInitializing gate tests (Phase 1 splash-gate feature)
  // -------------------------------------------------------------------------

  group('AuthNotifier — isInitializing splash gate', () {
    test(
        'freshly constructed AuthNotifier has isInitializing == true '
        'before any restore call',
        () {
      // No stub setup needed — we just inspect the initial state.
      expect(notifier.state.isInitializing, isTrue,
          reason: 'the router must hold on /splash until restore completes');
      expect(notifier.state.isAuthenticated, isFalse,
          reason: 'no session is known yet');
    });

    test(
        'tryRestoreSession with tokens + cached user + getProfile succeeds: '
        'isInitializing == false AND isAuthenticated == true',
        () async {
      // Arrange
      when(() => storage.hasTokens()).thenAnswer((_) async => true);
      when(() => storage.getUserData()).thenAnswer((_) async => _userJson());
      when(() => svc.getProfile()).thenAnswer((_) async => _kUser);
      when(() => storage.setUserData(any())).thenAnswer((_) async {});

      // Act
      await notifier.tryRestoreSession();

      // Assert
      expect(notifier.state.isInitializing, isFalse,
          reason: 'splash gate must release after restore completes');
      expect(notifier.state.isAuthenticated, isTrue,
          reason: 'online restore must authenticate the user');
    });

    test(
        'tryRestoreSession with tokens + cached user + getProfile throws '
        'connectionError (offline): isInitializing == false AND '
        'isAuthenticated == true (local cache is enough)',
        () async {
      // Arrange: tokens present, cached user present, network unreachable.
      when(() => storage.hasTokens()).thenAnswer((_) async => true);
      when(() => storage.getUserData()).thenAnswer((_) async => _userJson());
      when(() => svc.getProfile()).thenThrow(_connectionError());

      // Act
      await notifier.tryRestoreSession();

      // Assert: the splash gate must lift AND the session must survive.
      // isInitializing flips false from the local-cache path (before the
      // getProfile network call), so it must not depend on getProfile.
      expect(notifier.state.isInitializing, isFalse,
          reason: 'splash gate must release even when offline');
      expect(notifier.state.isAuthenticated, isTrue,
          reason: 'cached user keeps the session alive offline');
    });

    test(
        'tryRestoreSession with NO tokens stored: '
        'isInitializing == false AND isAuthenticated == false '
        'AND getProfile is never called',
        () async {
      // Arrange: storage has no tokens.
      when(() => storage.hasTokens()).thenAnswer((_) async => false);

      // Act
      await notifier.tryRestoreSession();

      // Assert
      expect(notifier.state.isInitializing, isFalse,
          reason: 'splash gate must release even when there is no session');
      expect(notifier.state.isAuthenticated, isFalse,
          reason: 'no tokens == no session');
      verifyNever(() => svc.getProfile());
    });
  });

  // -------------------------------------------------------------------------
  // _syncLocaleToBackend — always calls updateLanguage (language-sync fix)
  // -------------------------------------------------------------------------

  group('_syncLocaleToBackend — via tryRestoreSession', () {
    // Shared stubs for a successful online restore so _syncLocaleToBackend fires.
    setUp(() {
      when(() => storage.hasTokens()).thenAnswer((_) async => true);
      when(() => storage.getUserData()).thenAnswer((_) async => _userJson());
      when(() => svc.getProfile()).thenAnswer((_) async => _kUser);
      when(() => storage.setUserData(any())).thenAnswer((_) async {});
      when(() => svc.updateLanguage(any())).thenAnswer((_) async {});
    });

    test(
        'no stored locale → updateLanguage is called with system-derived code',
        () async {
      when(() => storage.getLocale()).thenAnswer((_) async => null);

      await notifier.tryRestoreSession();
      // Pump the microtask queue so the fire-and-forget .then() callback runs.
      await Future<void>.delayed(Duration.zero);

      // The test-runner system locale varies; we only assert it was called once.
      verify(() => svc.updateLanguage(any())).called(1);
    });

    test('stored ar locale → updateLanguage called with ar', () async {
      when(() => storage.getLocale()).thenAnswer((_) async => 'ar');

      await notifier.tryRestoreSession();
      await Future<void>.delayed(Duration.zero);

      verify(() => svc.updateLanguage('ar')).called(1);
    });

    test('stored en locale → updateLanguage called with en', () async {
      when(() => storage.getLocale()).thenAnswer((_) async => 'en');

      await notifier.tryRestoreSession();
      await Future<void>.delayed(Duration.zero);

      verify(() => svc.updateLanguage('en')).called(1);
    });
  });

  // -------------------------------------------------------------------------
  // register — forwards effective language to AuthService
  // -------------------------------------------------------------------------

  group('AuthNotifier.register — sends effective language', () {
    test('stored ar locale → register called with language: ar', () async {
      when(() => storage.getLocale()).thenAnswer((_) async => 'ar');
      stubRegisterSuccess();

      await notifier.register(
        name: 'Ali Wasel',
        email: 'ali@example.com',
        phone: '+966501234567',
        password: 'Abc@1234!',
      );

      verify(
        () => svc.register(
          name: 'Ali Wasel',
          email: 'ali@example.com',
          phone: '+966501234567',
          password: 'Abc@1234!',
          language: 'ar',
          businessName: null,
        ),
      ).called(1);
    });

    test('stored en locale → register called with language: en', () async {
      when(() => storage.getLocale()).thenAnswer((_) async => 'en');
      stubRegisterSuccess();

      await notifier.register(
        name: 'Bob Ops',
        email: 'bob@example.com',
        phone: '+966501234568',
        password: 'Abc@1234!',
      );

      verify(
        () => svc.register(
          name: 'Bob Ops',
          email: 'bob@example.com',
          phone: '+966501234568',
          password: 'Abc@1234!',
          language: 'en',
          businessName: null,
        ),
      ).called(1);
    });

    test('no stored locale → register called with system-derived code', () async {
      when(() => storage.getLocale()).thenAnswer((_) async => null);
      stubRegisterSuccess();

      await notifier.register(
        name: 'Sam Op',
        email: 'sam@example.com',
        phone: '+966501234569',
        password: 'Abc@1234!',
      );

      // We only assert language is non-null and register was called once.
      verify(
        () => svc.register(
          name: 'Sam Op',
          email: 'sam@example.com',
          phone: '+966501234569',
          password: 'Abc@1234!',
          language: any(named: 'language'),
        ),
      ).called(1);
    });
  });

  // -------------------------------------------------------------------------
  // verifyEmail — signs the user in
  // -------------------------------------------------------------------------

  group('AuthNotifier.verifyEmail — signs the user in', () {
    // Built via User.fromJson from the real verify-email/login response shape
    // ({id, name, email, role}) rather than the User(...) constructor, so
    // isVerified defaults to false exactly like production — that endpoint's
    // payload carries no is_verified field (unlike the /auth/me profile).
    final kUser = User.fromJson({
      'id': 'u-1',
      'name': 'Ali Wasel',
      'email': 'ali@example.com',
      'role': 'user',
    });
    final kLoginResult = LoginResult(
      accessToken: 'at',
      refreshToken: 'rt',
      user: kUser,
    );

    DioException otpInvalidError() => DioException(
          requestOptions: RequestOptions(path: '/auth/verify-email'),
          response: Response(
            requestOptions: RequestOptions(path: '/auth/verify-email'),
            statusCode: 400,
            data: {
              'error': {
                'code': 'OTP_INVALID',
                'message': 'Invalid or expired OTP',
              },
            },
          ),
          type: DioExceptionType.badResponse,
        );

    // getLocale is stubbed here ONLY — it backs both register()'s language
    // lookup and _completeSignIn's fire-and-forget _syncLocaleToBackend(), so
    // a single stub is load-bearing for every test in this group (call this
    // before any register()/login()/verifyEmail() invocation).
    void stubSignInDeps() {
      when(() => storage.setTokens(any(), any())).thenAnswer((_) async {});
      when(() => storage.setUserData(any())).thenAnswer((_) async {});
      when(() => storage.getLocale()).thenAnswer((_) async => 'en');
      when(() => svc.updateLanguage(any())).thenAnswer((_) async {});
    }

    test(
        'success: persists tokens + user, sets isAuthenticated, '
        'clears pendingVerificationEmail', () async {
      // Arrange: stubSignInDeps() also covers getLocale for the register()
      // precondition call below. Register first so pendingVerificationEmail
      // is set.
      stubSignInDeps();
      stubRegisterSuccess();
      await notifier.register(
        name: 'Ali Wasel',
        email: 'ali@example.com',
        phone: '+966501234567',
        password: 'Abc@1234!',
      );
      expect(notifier.state.pendingVerificationEmail, 'ali@example.com',
          reason: 'pre-condition: register must set pendingVerificationEmail');

      when(() => svc.verifyEmail(
            email: any(named: 'email'),
            otp: any(named: 'otp'),
          )).thenAnswer((_) async => kLoginResult);

      // Act
      await notifier.verifyEmail(email: 'ali@example.com', otp: '123456');
      await Future<void>.delayed(Duration.zero);

      // Assert
      expect(notifier.state.isAuthenticated, isTrue);
      expect(notifier.state.accessToken, 'at');
      expect(notifier.state.user, isNotNull);
      expect(notifier.state.user?.email, kUser.email);
      expect(notifier.state.pendingVerificationEmail, isNull);
      expect(notifier.state.isLoading, isFalse);
      verify(() => storage.setTokens('at', 'rt')).called(1);
      verify(() => storage.setUserData(json.encode(kUser.toJson())))
          .called(1);
      verify(() => svc.updateLanguage('en')).called(1);
    });

    test(
        'OTP_INVALID: rethrows, leaves user signed out, '
        'errorCode set, no tokens persisted', () async {
      when(() => svc.verifyEmail(
            email: any(named: 'email'),
            otp: any(named: 'otp'),
          )).thenThrow(otpInvalidError());

      await expectLater(
        () => notifier.verifyEmail(email: 'ali@example.com', otp: '000000'),
        throwsA(isA<DioException>()),
      );

      expect(notifier.state.isAuthenticated, isFalse);
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.error, isNotNull);
      expect(notifier.state.errorCode, 'OTP_INVALID');
      verifyNever(() => storage.setTokens(any(), any()));
      verifyNever(() => storage.setUserData(any()));
    });

    test(
        'setUserData throws (cached-profile write failure) => sign-in still '
        'completes: tokens persisted, isAuthenticated true '
        '(guards _completeSignIn surviving a cached-write failure)',
        () async {
      when(() => svc.verifyEmail(
            email: any(named: 'email'),
            otp: any(named: 'otp'),
          )).thenAnswer((_) async => kLoginResult);
      when(() => storage.setTokens(any(), any())).thenAnswer((_) async {});
      when(() => storage.setUserData(any()))
          .thenThrow(PlatformException(code: 'write_failed'));
      when(() => storage.getLocale()).thenAnswer((_) async => 'en');
      when(() => svc.updateLanguage(any())).thenAnswer((_) async {});

      await notifier.verifyEmail(email: 'ali@example.com', otp: '123456');
      await Future<void>.delayed(Duration.zero);

      expect(notifier.state.isAuthenticated, isTrue,
          reason: 'a cached-profile write failure must not strand the user '
              'signed-out — the server already verified the email and '
              'burned the OTP by this point');
      expect(notifier.state.accessToken, 'at');
      verify(() => storage.setTokens('at', 'rt')).called(1);
    });

    test(
        'login() success: uses the same persistence path '
        '(guards the _completeSignIn refactor)', () async {
      when(() => svc.login(
            email: any(named: 'email'),
            password: any(named: 'password'),
          )).thenAnswer((_) async => kLoginResult);
      stubSignInDeps();

      await notifier.login(email: 'ali@example.com', password: 'Abc@1234!');
      await Future<void>.delayed(Duration.zero);

      expect(notifier.state.isAuthenticated, isTrue);
      expect(notifier.state.accessToken, 'at');
      expect(notifier.state.user, isNotNull);
      expect(notifier.state.user?.email, kUser.email);
      expect(notifier.state.isLoading, isFalse);
      verify(() => storage.setTokens('at', 'rt')).called(1);
      verify(() => storage.setUserData(json.encode(kUser.toJson())))
          .called(1);
      verify(() => svc.updateLanguage('en')).called(1);
    });
  });

  group('AuthNotifier — session expiry via ApiClient.onSessionExpired', () {
    test(
        'onSessionExpired fires => isAuthenticated becomes false, '
        'clearSession is called once',
        () async {
      // Arrange: put the notifier into an authenticated state first.
      when(() => storage.hasTokens()).thenAnswer((_) async => true);
      when(() => storage.getUserData()).thenAnswer((_) async => _userJson());
      when(() => svc.getProfile()).thenAnswer((_) async => _kUser);
      when(() => storage.setUserData(any())).thenAnswer((_) async {});
      when(() => storage.clearSession()).thenAnswer((_) async {});

      await notifier.tryRestoreSession();
      expect(notifier.state.isAuthenticated, isTrue,
          reason: 'pre-condition: session must be active before expiry fires');

      // Act: simulate the ApiClient refresh interceptor detecting a 401 on
      // the refresh endpoint and calling onSessionExpired.
      ApiClient().onSessionExpired?.call();

      // Assert: session must be cleared.
      expect(notifier.state.isAuthenticated, isFalse,
          reason: 'a server-side rejection must clear the session');
      expect(notifier.state.isLoading, isFalse);
      // The notifier delegates storage wipe to _handleSessionExpired, which
      // clears only session keys (locale is preserved across sign-out).
      verify(() => storage.clearSession()).called(1);
    });
  });
}
