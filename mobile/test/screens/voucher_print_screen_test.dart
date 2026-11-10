/// Widget tests for VoucherPrintScreen Phase 3 changes.
///
/// Tests verify that the screen initialises its column slider from
/// [PrintSettings.defaultColumns] and shows the strips label for Strips
/// template instead of the slider.
///
/// PdfPreview (which calls the printing plugin) is avoided by overriding
/// PrintService with a fake that returns empty bytes and never builds a real
/// PDF isolate.
library;

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/models/print_settings.dart';
import 'package:wasel/models/voucher.dart';
import 'package:wasel/providers/print_settings_provider.dart';
import 'package:wasel/screens/vouchers/voucher_print_screen.dart';
import 'package:wasel/services/print_service.dart';
import 'package:wasel/services/print_settings_service.dart';
import 'package:wasel/services/secure_storage.dart';
import 'package:wasel/theme/app_theme.dart';

// ---------------------------------------------------------------------------
// Fake PrintService — returns empty valid PDF bytes, never spawns an isolate.
// ---------------------------------------------------------------------------

class _FakePrintService extends PrintService {
  @override
  Future<Uint8List> generateVouchersPdf(
    List<VoucherPrintItem> items,
    String businessName, {
    int columns = 4,
    String? docTitle,
    PrintSettings? settings,
    String? howToDefault,
  }) async {
    // Minimal non-empty bytes; PdfPreview won't rasterise in tests.
    return Uint8List(0);
  }
}

// ---------------------------------------------------------------------------
// Fake PrintSettingsNotifier
// ---------------------------------------------------------------------------

class _FakePrintSettingsNotifier extends PrintSettingsNotifier {
  _FakePrintSettingsNotifier(PrintSettings s)
      : super(service: _NoopService(), storage: _NoopStorage()) {
    state = PrintSettingsState(settings: s);
  }

  @override
  Future<void> load() async {}
}

class _NoopService implements PrintSettingsService {
  @override
  Future<PrintSettings> fetch() async => const PrintSettings();
  @override
  Future<PrintSettings> update(PrintSettings s) async => s;
}

class _NoopStorage implements SecureStorageService {
  @override
  dynamic noSuchMethod(Invocation invocation) async {}
}

// ---------------------------------------------------------------------------
// Sample voucher
// ---------------------------------------------------------------------------

Voucher _fakeVoucher() => Voucher.fromJson({
      'id': 'v-1',
      'userId': 'u-1',
      'routerId': 'r-1',
      'username': '12345678',
      'password': 'pass',
      'status': 'active',
      'limitType': 'time',
      'limitValue': 60,
      'limitUnit': 'minutes',
      'validitySeconds': 3600,
      'createdAt': '2026-11-01T14:30:00.000Z',
      'updatedAt': '2026-11-01T14:30:00.000Z',
    });

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

Widget _buildApp(PrintSettings settings) {
  return ProviderScope(
    overrides: [
      printSettingsProvider
          .overrideWith((_) => _FakePrintSettingsNotifier(settings)),
    ],
    child: MaterialApp(
      theme: AppTheme.light,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: VoucherPrintScreen(
        vouchers: [_fakeVoucher()],
        routerName: 'Test Router',
        printService: _FakePrintService(),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('VoucherPrintScreen (Phase 3)', () {
    testWidgets(
        'column slider shows defaultColumns value from settings',
        (tester) async {
      await tester.pumpWidget(_buildApp(const PrintSettings(defaultColumns: 6)));
      // Allow one frame for the addPostFrameCallback in _maybeInitColumns.
      await tester.pump();
      await tester.pump();

      // The ColumnSliderBar shows "Columns: N".
      expect(find.textContaining('Columns: 6'), findsOneWidget);
    });

    testWidgets('Strips template shows strips-per-page label, not slider',
        (tester) async {
      await tester.pumpWidget(_buildApp(const PrintSettings(
        templateId: VoucherTemplateId.strips,
        knobs: PrintKnobs(stripsPerPage: 8),
      )));
      await tester.pump();
      await tester.pump();

      // Strips label present (e.g. "8 per page").
      expect(find.textContaining('per page'), findsOneWidget);
      // Column slider absent.
      expect(find.textContaining('Columns:'), findsNothing);
    });
  });
}
