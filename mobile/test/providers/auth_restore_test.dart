import 'dart:convert';

import 'package:dio/dio.dart';
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
