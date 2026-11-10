import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/models/print_settings.dart';
import 'package:wasel/providers/print_settings_provider.dart';
import 'package:wasel/services/print_settings_service.dart';
import 'package:wasel/services/secure_storage.dart';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockPrintSettingsService extends Mock implements PrintSettingsService {}

class MockSecureStorage extends Mock implements SecureStorageService {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _kDefaults = PrintSettings();

PrintSettings _settings({int codeLength = 8}) =>
    PrintSettings(codeLength: codeLength);

PrintSettingsNotifier _make({
  required MockPrintSettingsService service,
  required MockSecureStorage storage,
}) =>
    PrintSettingsNotifier(service: service, storage: storage);

void main() {
  late MockPrintSettingsService service;
  late MockSecureStorage storage;
  late PrintSettingsNotifier notifier;

  setUp(() {
    service = MockPrintSettingsService();
    storage = MockSecureStorage();
    notifier = _make(service: service, storage: storage);
  });

  group('PrintSettingsNotifier', () {
    // ---- initial state ----

    test('initial state is empty / not loading', () {
      expect(notifier.state.isEmpty, isTrue);
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.error, isNull);
    });

    // ---- load: cache-first then network ----

    test('load publishes cached value first, then network value', () async {
      final cached = _settings(codeLength: 8);
      when(() => storage.getPrintSettingsJson())
          .thenAnswer((_) async => jsonEncode(cached.toJson()));
      when(() => storage.setPrintSettingsJson(any())).thenAnswer((_) async {});

      final fresh = _settings(codeLength: 10);
      when(() => service.fetch()).thenAnswer((_) async => fresh);

      final states = <PrintSettingsState>[];
      notifier.addListener(states.add, fireImmediately: false);

      await notifier.load();

      // Should have at least two non-empty states: cached (isFromCache=true)
      // and fresh (isFromCache=false).
      final cachedState = states.firstWhere((s) => s.isFromCache);
      final freshState = states.lastWhere((s) => !s.isFromCache && !s.isEmpty);

      expect(cachedState.settings?.codeLength, 8);
      expect(freshState.settings?.codeLength, 10);
    });

    test('load with no cache and network error surfaces error', () async {
      when(() => storage.getPrintSettingsJson()).thenAnswer((_) async => null);
      when(() => service.fetch()).thenThrow(Exception('network'));

      await notifier.load();

      expect(notifier.state.error, isNotNull);
      expect(notifier.state.isEmpty, isTrue);
    });

    test('load with cache and network error keeps cached value silently',
        () async {
      final cached = _settings(codeLength: 8);
      when(() => storage.getPrintSettingsJson())
          .thenAnswer((_) async => jsonEncode(cached.toJson()));
      when(() => service.fetch()).thenThrow(Exception('network'));

      await notifier.load();

      // Settings are present from cache; no hard error (stays in cache mode).
      expect(notifier.state.settings?.codeLength, 8);
      expect(notifier.state.isFromCache, isTrue);
      // No error surfaced because a cached value is usable.
      expect(notifier.state.error, isNull);
    });

    // ---- save: optimistic + rollback ----

    test('save applies optimistically and confirms on success', () async {
      // Seed a loaded state.
      when(() => storage.getPrintSettingsJson()).thenAnswer((_) async => null);
      when(() => service.fetch()).thenAnswer((_) async => _kDefaults);
      when(() => storage.setPrintSettingsJson(any())).thenAnswer((_) async {});
      await notifier.load();

      final next = _settings(codeLength: 10);
      when(() => service.update(next)).thenAnswer((_) async => next);

      await notifier.save(next);

      expect(notifier.state.settings?.codeLength, 10);
      expect(notifier.state.error, isNull);
    });

    test('save rolls back on network failure', () async {
      // Seed a loaded state with codeLength=8.
      when(() => storage.getPrintSettingsJson()).thenAnswer((_) async => null);
      when(() => service.fetch()).thenAnswer((_) async => _kDefaults);
      when(() => storage.setPrintSettingsJson(any())).thenAnswer((_) async {});
      await notifier.load();

      final previous = notifier.state.settings!;
      final next = _settings(codeLength: 10);
      when(() => service.update(next)).thenThrow(Exception('server error'));

      await notifier.save(next);

      // Rolled back to previous.
      expect(notifier.state.settings?.codeLength, previous.codeLength);
      expect(notifier.state.error, isNotNull);
    });
  });
}
