import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
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

  // ── Arabic locale: limit field label follows selected unit ────────────────

  group('CreateVoucherWizard limit field label (Arabic)', () {
    testWidgets('default shows أدخل عدد الساعات and القيمة appears nowhere',
        (tester) async {
      final notifier = _FakeRoutersNotifier(routers: [_fakeRouter()]);

      await tester.pumpWidget(
        _buildApp(routersNotifier: notifier, locale: const Locale('ar')),
      );
      await tester.pump();

      expect(find.textContaining('أدخل عدد الساعات'), findsOneWidget,
          reason: 'default hours unit must show أدخل عدد الساعات');
      expect(find.textContaining('القيمة'), findsNothing,
          reason: 'generic label القيمة must not appear anywhere');
    });

    testWidgets('tapping Data Limit changes label to أدخل عدد الجيجابايت',
        (tester) async {
      final notifier = _FakeRoutersNotifier(routers: [_fakeRouter()]);

      await tester.pumpWidget(
        _buildApp(routersNotifier: notifier, locale: const Locale('ar')),
      );
      await tester.pump();

      await tester.tap(find.textContaining('حد بيانات'));
      await tester.pumpAndSettle();

      expect(find.textContaining('أدخل عدد الجيجابايت'), findsOneWidget,
          reason: 'switching to data limit must show أدخل عدد الجيجابايت');
    });

    testWidgets('changing unit to minutes changes label to أدخل عدد الدقائق',
        (tester) async {
      final notifier = _FakeRoutersNotifier(routers: [_fakeRouter()]);

      await tester.pumpWidget(
        _buildApp(routersNotifier: notifier, locale: const Locale('ar')),
      );
      await tester.pump();

      // Open the unit dropdown and select دقائق
      await tester.tap(find.text('ساعات'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('دقائق').last);
      await tester.pumpAndSettle();

      expect(find.textContaining('أدخل عدد الدقائق'), findsOneWidget,
          reason: 'selecting minutes unit must show أدخل عدد الدقائق');
    });

    testWidgets('info line mentions price in time mode', (tester) async {
      final notifier = _FakeRoutersNotifier(routers: [_fakeRouter()]);

      await tester.pumpWidget(
        _buildApp(routersNotifier: notifier, locale: const Locale('ar')),
      );
      await tester.pump();

      expect(find.textContaining('السعر تدخله في الخطوة الأخيرة'), findsOneWidget,
          reason: 'time-limit hint must contain the price-step sentence');
    });

    testWidgets('info line mentions price in data mode', (tester) async {
      final notifier = _FakeRoutersNotifier(routers: [_fakeRouter()]);

      await tester.pumpWidget(
        _buildApp(routersNotifier: notifier, locale: const Locale('ar')),
      );
      await tester.pump();

      await tester.tap(find.textContaining('حد بيانات'));
      await tester.pumpAndSettle();

      expect(find.textContaining('السعر تدخله في الخطوة الأخيرة'), findsOneWidget,
          reason: 'data-limit hint must contain the price-step sentence');
    });
  });

  // ── Arabic locale: validity buttons use correct number agreement ──────────

  group('CreateVoucherWizard validity buttons (Arabic)', () {
    testWidgets('show correct Arabic forms', (tester) async {
      final notifier = _FakeRoutersNotifier(routers: [_fakeRouter()]);

      await tester.pumpWidget(
        _buildApp(routersNotifier: notifier, locale: const Locale('ar')),
      );
      await tester.pump();

      await tester.enterText(find.byType(TextFormField).first, '2');
      await tester.tap(find.widgetWithText(ElevatedButton, 'التالي'));
      await tester.pumpAndSettle();

      for (final label in [
        '1 ساعة',
        '6 ساعات',
        '12 ساعة',
        '1 يوم',
        '3 أيام',
        '7 أيام',
        '30 يوم',
      ]) {
        expect(find.text(label), findsOneWidget, reason: label);
      }
      for (final wrong in ['6 ساعة', '3 يوم', '7 يوم']) {
        expect(find.text(wrong), findsNothing, reason: wrong);
      }
    });
  });

  // ── Arabic locale: custom validity field follows unit ─────────────────────

  group('CreateVoucherWizard custom validity field label (Arabic)', () {
    testWidgets('custom validity field shows أدخل عدد الساعات for hours',
        (tester) async {
      final notifier = _FakeRoutersNotifier(routers: [_fakeRouter()]);

      await tester.pumpWidget(
        _buildApp(routersNotifier: notifier, locale: const Locale('ar')),
      );
      await tester.pump();

      // Advance to step 1 (validity)
      await tester.enterText(find.byType(TextFormField).first, '2');
      await tester.tap(find.widgetWithText(ElevatedButton, 'التالي'));
      await tester.pumpAndSettle();

      // Tap the "مخصص" chip to reveal the custom field
      await tester.tap(find.text('مخصص'));
      await tester.pumpAndSettle();

      expect(find.textContaining('أدخل عدد الساعات'), findsOneWidget,
          reason: 'custom validity field (hours) must show أدخل عدد الساعات');
    });

    testWidgets('custom validity field shows أدخل عدد الأيام after switching to days',
        (tester) async {
      final notifier = _FakeRoutersNotifier(routers: [_fakeRouter()]);

      await tester.pumpWidget(
        _buildApp(routersNotifier: notifier, locale: const Locale('ar')),
      );
      await tester.pump();

      // Advance to step 1
      await tester.enterText(find.byType(TextFormField).first, '2');
      await tester.tap(find.widgetWithText(ElevatedButton, 'التالي'));
      await tester.pumpAndSettle();

      // Tap مخصص
      await tester.tap(find.text('مخصص'));
      await tester.pumpAndSettle();

      // Switch unit to days
      await tester.tap(find.text('ساعات').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('أيام').last);
      await tester.pumpAndSettle();

      expect(find.textContaining('أدخل عدد الأيام'), findsOneWidget,
          reason: 'custom validity field (days) must show أدخل عدد الأيام');
    });
  });

  // ── 320-wide layout: no overflow ──────────────────────────────────────────

  group('CreateVoucherWizard layout on 320-wide screen', () {
    // flutter_test renders every glyph as a full-width square unless the real
    // font is loaded, which reports overflows no phone would ever show.
    setUpAll(() async {
      final loader = FontLoader('Cairo');
      for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
        loader.addFont(rootBundle.load('assets/fonts/Cairo-$weight.ttf'));
      }
      await loader.load();
    });

    Future<void> pumpNarrow(WidgetTester tester, Locale locale) async {
      tester.view.physicalSize = const Size(320 * 3, 640 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(_buildApp(
        routersNotifier: _FakeRoutersNotifier(routers: [_fakeRouter()]),
        locale: locale,
      ));
      await tester.pump();
    }

    for (final (locale, dataLimit, next, custom) in const [
      (Locale('ar'), 'حد بيانات', 'التالي', 'مخصص'),
      (Locale('en'), 'Data Limit', 'Next', 'Custom'),
    ]) {
      testWidgets('limit step fits in time and data modes (${locale.languageCode})',
          (tester) async {
        await pumpNarrow(tester, locale);
        expect(tester.takeException(), isNull);

        await tester.tap(find.text(dataLimit));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('custom validity fits (${locale.languageCode})', (tester) async {
        await pumpNarrow(tester, locale);

        await tester.enterText(find.byType(TextFormField).first, '2');
        await tester.tap(find.widgetWithText(ElevatedButton, next));
        await tester.pumpAndSettle();
        await tester.tap(find.text(custom));
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('long unit names are not cut off (ar)', (tester) async {
      void expectFits(String unit) {
        final text = tester.renderObject<RenderParagraph>(find.text(unit));
        expect(text.getMaxIntrinsicWidth(double.infinity),
            lessThanOrEqualTo(text.size.width),
            reason: '$unit must fit the unit picker');
      }

      await pumpNarrow(tester, const Locale('ar'));
      await tester.tap(find.text('حد بيانات'));
      await tester.pumpAndSettle();
      expectFits('جيجابايت');

      await tester.tap(find.text('جيجابايت'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('ميجابايت').last);
      await tester.pumpAndSettle();
      expectFits('ميجابايت');
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
