import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/models/print_settings.dart';
import 'package:wasel/providers/print_settings_provider.dart';
import 'package:wasel/screens/settings/voucher_printing_screen.dart';
import 'package:wasel/services/print_settings_service.dart';
import 'package:wasel/services/secure_storage.dart';
import 'package:wasel/services/thumbnail_renderer.dart';
import 'package:wasel/theme/app_theme.dart';

// ---------------------------------------------------------------------------
// Minimal valid 1×1 PNG — avoids Printing.raster under flutter test.
// ---------------------------------------------------------------------------

final Uint8List _kFakePng = Uint8List.fromList([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
  0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
]);

class _FakeThumbnailRenderer implements ThumbnailRenderer {
  @override
  Future<Uint8List> render(id, routerName, sampleSettings, sampleItems) async =>
      _kFakePng;
}

// ---------------------------------------------------------------------------
// Fake PrintSettingsNotifier — pre-seeded, no network calls.
// ---------------------------------------------------------------------------

class _FakePrintSettingsNotifier extends PrintSettingsNotifier {
  _FakePrintSettingsNotifier(PrintSettings settings)
      : super(service: _NoopService(), storage: _NoopStorage()) {
    state = PrintSettingsState(settings: settings);
  }

  @override
  Future<void> load() async {}

  @override
  Future<void> save(PrintSettings next) async {
    state = state.copyWith(settings: next);
  }
}

class _NoopService implements PrintSettingsService {
  @override
  Future<PrintSettings> fetch() async => const PrintSettings();

  @override
  Future<PrintSettings> update(PrintSettings settings) async => settings;
}

class _NoopStorage implements SecureStorageService {
  @override
  dynamic noSuchMethod(Invocation invocation) async {}
}

// ---------------------------------------------------------------------------
// Helper: pump the screen.
// ---------------------------------------------------------------------------

Widget _buildApp(PrintSettings settings) {
  return ProviderScope(
    overrides: [
      printSettingsProvider
          .overrideWith((_) => _FakePrintSettingsNotifier(settings)),
      thumbnailRendererProvider
          .overrideWithValue(_FakeThumbnailRenderer()),
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
      home: const VoucherPrintingScreen(),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('VoucherPrintingScreen', () {
    testWidgets('shows three template tiles', (tester) async {
      await tester.pumpWidget(_buildApp(const PrintSettings()));
      await tester.pump();

      expect(find.text('Classic'), findsWidgets);
      expect(find.text('Detailed'), findsWidgets);
      expect(find.text('Strips'), findsWidgets);
    });

    testWidgets(
        'Classic: Show Price switch present; no Strips-per-page, no Show QR',
        (tester) async {
      await tester.pumpWidget(
          _buildApp(const PrintSettings(templateId: VoucherTemplateId.classic)));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
          find.text('Show Price', skipOffstage: false),
          find.byType(ListView),
          const Offset(0, -200));
      await tester.pump();

      expect(find.text('Show Price'), findsOneWidget);
      expect(find.text('Show QR Code', skipOffstage: false), findsNothing);
      expect(find.text('Strips per Page', skipOffstage: false), findsNothing);
    });

    testWidgets('Detailed: shows Show QR Code and Show Batch Label',
        (tester) async {
      await tester.pumpWidget(
          _buildApp(const PrintSettings(templateId: VoucherTemplateId.detailed)));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
          find.text('Show QR Code', skipOffstage: false),
          find.byType(ListView),
          const Offset(0, -200));
      await tester.pump();

      expect(find.text('Show QR Code'), findsOneWidget);
      expect(find.text('Show Batch Label', skipOffstage: false), findsWidgets);
    });

    testWidgets(
        'Detailed with showQr=false hides Hotspot Address field',
        (tester) async {
      await tester.pumpWidget(_buildApp(const PrintSettings(
        templateId: VoucherTemplateId.detailed,
        knobs: PrintKnobs(showQr: false),
      )));
      await tester.pumpAndSettle();

      expect(find.text('Hotspot Address', skipOffstage: false), findsNothing);
    });

    testWidgets(
        'Detailed with showQr=true shows Hotspot Address field',
        (tester) async {
      await tester.pumpWidget(_buildApp(const PrintSettings(
        templateId: VoucherTemplateId.detailed,
        knobs: PrintKnobs(showQr: true),
      )));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
          find.text('Hotspot Address', skipOffstage: false),
          find.byType(ListView),
          const Offset(0, -200));
      await tester.pump();

      expect(find.text('Hotspot Address'), findsOneWidget);
    });

    testWidgets(
        'Strips: shows Show Batch Label and Strips per Page; hides Default Columns',
        (tester) async {
      await tester.pumpWidget(
          _buildApp(const PrintSettings(templateId: VoucherTemplateId.strips)));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
          find.text('Show Batch Label', skipOffstage: false),
          find.byType(ListView),
          const Offset(0, -200));
      await tester.pump();

      expect(find.text('Show Batch Label'), findsOneWidget);
      expect(find.text('Strips per Page', skipOffstage: false), findsWidgets);
      expect(find.text('Default Columns', skipOffstage: false), findsNothing);
    });

    testWidgets(
        'code-length minus button disabled at minimum (6)', (tester) async {
      await tester.pumpWidget(
          _buildApp(const PrintSettings(codeLength: 6)));
      await tester.pump();

      // All IconButton widgets with Icons.remove should have onPressed == null.
      final buttons = tester.widgetList<IconButton>(
          find.byType(IconButton));
      final removeButtons = buttons.where((b) {
        final icon = b.icon;
        return icon is Icon && icon.icon == Icons.remove;
      });
      expect(removeButtons.any((b) => b.onPressed == null), isTrue);
    });

    testWidgets(
        'code-length plus button disabled at maximum (12)', (tester) async {
      await tester.pumpWidget(
          _buildApp(const PrintSettings(codeLength: 12)));
      await tester.pump();

      final buttons = tester.widgetList<IconButton>(find.byType(IconButton));
      final addButtons = buttons.where((b) {
        final icon = b.icon;
        return icon is Icon && icon.icon == Icons.add;
      });
      expect(addButtons.any((b) => b.onPressed == null), isTrue);
    });

    testWidgets('warning shown when codeLength < 8', (tester) async {
      await tester.pumpWidget(
          _buildApp(const PrintSettings(codeLength: 7)));
      await tester.pump();

      expect(find.textContaining('easier to guess'), findsOneWidget);
    });

    testWidgets('no warning when codeLength >= 8', (tester) async {
      await tester.pumpWidget(
          _buildApp(const PrintSettings(codeLength: 8)));
      await tester.pump();

      expect(find.textContaining('easier to guess'), findsNothing);
    });
  });
}
