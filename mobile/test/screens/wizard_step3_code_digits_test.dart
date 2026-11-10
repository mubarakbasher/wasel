/// Widget test: wizard step 3 shows the "Codes will be N digits" summary row.
///
/// This test file covers only the code-digits feature added in Phase 3.
/// It is intentionally narrow so the full wizard test suite stays stable.
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/models/print_settings.dart';
import 'package:wasel/models/router_model.dart';
import 'package:wasel/providers/print_settings_provider.dart';
import 'package:wasel/providers/routers_provider.dart';
import 'package:wasel/providers/vouchers_provider.dart';
import 'package:wasel/screens/vouchers/create_voucher_wizard.dart';
import 'package:wasel/services/print_settings_service.dart';
import 'package:wasel/services/secure_storage.dart';
import 'package:wasel/theme/app_theme.dart';

// ---------------------------------------------------------------------------
// Fakes
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

class _FakeRoutersNotifier extends RoutersNotifier {
  _FakeRoutersNotifier() {
    state = RoutersState(routers: [
      RouterModel(
        id: 'r-1',
        userId: 'u-1',
        name: 'Test Router',
        status: 'online',
        createdAt: DateTime(2026),
        updatedAt: DateTime(2026),
      ),
    ]);
  }

  @override
  Future<void> loadRouters() async {}
}

class _FakeVouchersNotifier extends VouchersNotifier {
  @override
  void clearError() {}
}

// ---------------------------------------------------------------------------
// Helper: advance to step 3 (Count & Price step).
// ---------------------------------------------------------------------------

Widget _buildApp({int codeLength = 8}) {
  return ProviderScope(
    overrides: [
      printSettingsProvider.overrideWith(
          (_) => _FakePrintSettingsNotifier(PrintSettings(codeLength: codeLength))),
      routersProvider.overrideWith((_) => _FakeRoutersNotifier()),
      vouchersProvider.overrideWith((_) => _FakeVouchersNotifier()),
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
      home: const CreateVoucherWizard(routerId: 'r-1'),
    ),
  );
}

/// Advance from step 0 (Limit) → step 1 (Validity) → step 2 (Count/Price).
Future<void> _advanceToStep3(WidgetTester tester) async {
  // Step 0 (Limit): fill in a valid limit value so the validator passes.
  final limitField = find.byType(TextFormField).first;
  await tester.enterText(limitField, '1');
  await tester.pump();

  // Step 0 → 1:
  await tester.tap(find.text('Next'));
  await tester.pumpAndSettle();

  // Step 1 → 2:
  await tester.tap(find.text('Next'));
  await tester.pumpAndSettle();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('Wizard step 3 — code digits row', () {
    testWidgets('shows "Codes will be 8 digits" with codeLength=8',
        (tester) async {
      await tester.pumpWidget(_buildApp(codeLength: 8));
      await tester.pumpAndSettle();

      await _advanceToStep3(tester);

      // Scroll to find the row in case it is below the fold.
      await tester.dragUntilVisible(
        find.textContaining('8 digits', skipOffstage: false),
        find.byType(ListView),
        const Offset(0, -200),
      );
      await tester.pump();

      expect(find.textContaining('8 digits'), findsOneWidget);
    });

    testWidgets('shows "Codes will be 10 digits" with codeLength=10',
        (tester) async {
      await tester.pumpWidget(_buildApp(codeLength: 10));
      await tester.pumpAndSettle();

      await _advanceToStep3(tester);

      await tester.dragUntilVisible(
        find.textContaining('10 digits', skipOffstage: false),
        find.byType(ListView),
        const Offset(0, -200),
      );
      await tester.pump();

      expect(find.textContaining('10 digits'), findsOneWidget);
    });
  });
}
