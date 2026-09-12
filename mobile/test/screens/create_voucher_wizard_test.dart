import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/models/router_model.dart';
import 'package:wasel/providers/routers_provider.dart';
import 'package:wasel/providers/vouchers_provider.dart';
import 'package:wasel/screens/vouchers/create_voucher_wizard.dart';
import 'package:wasel/theme/app_theme.dart';

// ---------------------------------------------------------------------------
// Fake RoutersNotifier — records whether loadRouters() was called and starts
// with a caller-supplied list so we can test both the empty and pre-seeded
// paths without touching the network.
// ---------------------------------------------------------------------------

class _FakeRoutersNotifier extends RoutersNotifier {
  bool loadRoutersCalled = false;

  _FakeRoutersNotifier({List<RouterModel> routers = const []}) {
    state = RoutersState(routers: routers);
  }

  @override
  Future<void> loadRouters() async {
    loadRoutersCalled = true;
  }
}

// ---------------------------------------------------------------------------
// Fake VouchersNotifier — prevents any real network calls from the provider
// that CreateVoucherWizard watches in its build method.
// ---------------------------------------------------------------------------

class _FakeVouchersNotifier extends VouchersNotifier {
  _FakeVouchersNotifier() : super();

  @override
  void clearError() {}
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const _kRouterId = 'r-1';

RouterModel _fakeRouter() => RouterModel(
      id: _kRouterId,
      userId: 'u-1',
      name: 'Office Router',
      status: 'online',
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );

// ---------------------------------------------------------------------------
// Helper — pumps CreateVoucherWizard inside a full localization stack.
// ---------------------------------------------------------------------------

Widget _buildApp({
  required _FakeRoutersNotifier routersNotifier,
  Locale? locale,
}) {
  return ProviderScope(
    overrides: [
      routersProvider.overrideWith((ref) => routersNotifier),
      vouchersProvider.overrideWith((ref) => _FakeVouchersNotifier()),
    ],
    child: MaterialApp(
      // The real app theme is load-bearing: it sets ElevatedButton minimumSize
      // to an infinite width, which crashes unbounded-Row button slots.
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const CreateVoucherWizard(routerId: _kRouterId),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests — focused on the initState router-name pre-fetch behaviour.
// ---------------------------------------------------------------------------

void main() {
  group('CreateVoucherWizard.initState router pre-fetch', () {
    testWidgets(
        'Case A: empty router list → loadRouters() is called on init',
        (tester) async {
      final notifier = _FakeRoutersNotifier(routers: []);

      await tester.pumpWidget(_buildApp(routersNotifier: notifier));
      // Allow the Future.microtask scheduled in initState to execute.
      await tester.pump();

      expect(notifier.loadRoutersCalled, isTrue,
          reason: 'wizard must fetch routers when the list is empty '
              'so the router name is available for the success dialog');
    });

    testWidgets(
        'Case B: router already in state → loadRouters() is NOT called',
        (tester) async {
      final notifier = _FakeRoutersNotifier(routers: [_fakeRouter()]);

      await tester.pumpWidget(_buildApp(routersNotifier: notifier));
      await tester.pump();

      expect(notifier.loadRoutersCalled, isFalse,
          reason: 'wizard must not redundantly re-fetch when the router '
              'is already present in state');
    });
  });

  // ── Arabic locale: Step 3 summary shows localised unit and currency ────────

  group('CreateVoucherWizard Step 3 summary under Arabic locale', () {
    testWidgets(
        'shows ساعات (not raw "hours") and ج.س currency symbol in summary',
        (tester) async {
      final notifier = _FakeRoutersNotifier(routers: [_fakeRouter()]);

      await tester.pumpWidget(
        _buildApp(routersNotifier: notifier, locale: const Locale('ar')),
      );
      await tester.pump();

      // ── Step 0: Limit ─────────────────────────────────────────────────────
      // Default state: limitType = 'time', limitUnit = 'hours'.
      // Enter limit value so step-0 form validation passes.
      await tester.enterText(
        find.byType(TextFormField).first,
        '2',
      );

      // Tap "التالي" (Next) to advance to step 1 (Validity).
      await tester.tap(find.widgetWithText(ElevatedButton, 'التالي'));
      await tester.pumpAndSettle();

      // ── Step 1: Validity ──────────────────────────────────────────────────
      // Default is open-validity — no further input needed.
      // Tap "التالي" again to reach step 2 (Count & Price / summary).
      await tester.tap(find.widgetWithText(ElevatedButton, 'التالي'));
      await tester.pumpAndSettle();

      // ── Step 2: Summary assertions ────────────────────────────────────────
      // The limit summary row should use the localised Arabic unit label.
      expect(
        find.textContaining('ساعات'),
        findsAtLeastNWidgets(1),
        reason: 'localizedUnitLabel must translate "hours" → "ساعات" in ar; '
            'the raw English string must never appear in the summary',
      );
      expect(
        find.textContaining('hours'),
        findsNothing,
        reason: 'raw English "hours" must not appear anywhere in the Arabic UI',
      );

      // The price row must include the localised currency symbol.
      expect(
        find.textContaining('ج.س'),
        findsAtLeastNWidgets(1),
        reason: 'common.currencySymbol (ج.س) must appear in the price row '
            'of the Arabic summary',
      );
    });
  });
}
