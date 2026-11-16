import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/models/card_speed_setting.dart';
import 'package:wasel/models/print_settings.dart';
import 'package:wasel/providers/auth_provider.dart';
import 'package:wasel/providers/card_speed_provider.dart';
import 'package:wasel/providers/print_settings_provider.dart';
import 'package:wasel/services/auth_service.dart';
import 'package:wasel/services/card_speed_service.dart';
import 'package:wasel/services/print_settings_service.dart';
import 'package:wasel/services/secure_storage.dart';

// ---------------------------------------------------------------------------
// Minimal fakes / mocks
// ---------------------------------------------------------------------------

class _MockAuthService extends Mock implements AuthService {}

class _MockStorage extends Mock implements SecureStorageService {}

class _FakeCardSpeedService implements CardSpeedService {
  final Completer<CardSpeedSetting?> completer = Completer();

  @override
  Future<CardSpeedSetting?> fetch() => completer.future;

  @override
  Future<CardSpeedSetting> update({required bool enabled, required String speed}) =>
      Future.value(CardSpeedSetting(enabled: enabled, speed: speed));
}

class _FakePrintSettingsService implements PrintSettingsService {
  @override
  Future<PrintSettings> fetch() async => const PrintSettings();

  @override
  Future<PrintSettings> update(PrintSettings s) async => s;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('AuthNotifier.logout clears user-scoped state', () {
    late _MockAuthService authSvc;
    late _MockStorage storage;
    late _FakeCardSpeedService speedSvc;
    late ProviderContainer container;

    setUp(() {
      authSvc = _MockAuthService();
      storage = _MockStorage();
      speedSvc = _FakeCardSpeedService();

      // Stub logout — succeeds silently.
      when(() => authSvc.logout(refreshToken: any(named: 'refreshToken')))
          .thenAnswer((_) async {});
      // Stub storage calls made during logout.
      when(() => storage.getRefreshToken()).thenAnswer((_) async => 'rt');
      when(() => storage.clearSession()).thenAnswer((_) async {});

      container = ProviderContainer(
        overrides: [
          // Override authProvider to inject mock services, but keep the real
          // Ref so that _resetUserScopedProviders can reach sibling providers.
          authProvider.overrideWith(
            (ref) => AuthNotifier(
              ref: ref,
              authService: authSvc,
              storageService: storage,
            ),
          ),
          cardSpeedProvider.overrideWith(
            (ref) => CardSpeedNotifier(service: speedSvc),
          ),
          printSettingsProvider.overrideWith(
            (_) => PrintSettingsNotifier(
              service: _FakePrintSettingsService(),
              storage: storage,
            ),
          ),
        ],
      );
    });

    tearDown(() => container.dispose());

    test('logout clears card speed state', () async {
      // Seed card speed.
      speedSvc.completer.complete(
          const CardSpeedSetting(enabled: true, speed: '5M'));
      await container.read(cardSpeedProvider.notifier).load();
      expect(container.read(cardSpeedProvider).setting?.speed, '5M',
          reason: 'pre-condition: state seeded');

      await container.read(authProvider.notifier).logout();

      expect(container.read(cardSpeedProvider).setting, isNull,
          reason: 'card speed must be cleared after logout');
      expect(container.read(cardSpeedProvider).unavailable, isFalse);
      expect(container.read(cardSpeedProvider).error, isNull);
    });

    test('logout clears print settings state', () async {
      // Seed print settings via a successful load.
      await container.read(printSettingsProvider.notifier).load();

      await container.read(authProvider.notifier).logout();

      expect(container.read(printSettingsProvider).settings, isNull,
          reason: 'print settings must be cleared after logout');
      expect(container.read(printSettingsProvider).isLoading, isFalse);
    });
  });
}
