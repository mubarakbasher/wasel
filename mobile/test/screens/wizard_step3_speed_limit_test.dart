/// Widget tests: wizard step 3 speed-limit strip, summary row, success dialog.
library;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/models/card_speed_setting.dart';
import 'package:wasel/models/print_settings.dart';
import 'package:wasel/models/router_model.dart';
import 'package:wasel/models/voucher.dart';
import 'package:wasel/providers/card_speed_provider.dart';
import 'package:wasel/providers/print_settings_provider.dart';
import 'package:wasel/providers/routers_provider.dart';
import 'package:wasel/providers/vouchers_provider.dart';
import 'package:wasel/screens/vouchers/create_voucher_wizard.dart';
import 'package:wasel/services/card_speed_service.dart';
import 'package:wasel/services/print_settings_service.dart';
import 'package:wasel/services/secure_storage.dart';
import 'package:wasel/theme/app_theme.dart';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class _FakePrintSettingsNotifier extends PrintSettingsNotifier {
  _FakePrintSettingsNotifier()
      : super(service: _NoopPrintService(), storage: _NoopStorage()) {
    state = const PrintSettingsState(settings: PrintSettings());
  }

  @override
  Future<void> load() async {}
}

class _NoopPrintService implements PrintSettingsService {
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

class _FakeCardSpeedNotifier extends CardSpeedNotifier {
  int loadCalls = 0;
  final CardSpeedState _initial;

  _FakeCardSpeedNotifier(this._initial)
      : super(service: _NoopCardSpeedService()) {
    state = _initial;
  }

  @override
  Future<void> load() async {
    loadCalls++;
  }
}

class _NoopCardSpeedService extends CardSpeedService {
  @override
  Future<CardSpeedSetting?> fetch() async => null;
  @override
  Future<CardSpeedSetting> update({
    required bool enabled,
    required String speed,
  }) async =>
      CardSpeedSetting(enabled: enabled, speed: speed, options: const []);
}

class _FakeVouchersNotifier extends VouchersNotifier {
  final List<Voucher>? _result;

  _FakeVouchersNotifier({List<Voucher>? result}) : _result = result;

  @override
  void clearError() {}

  @override
  Future<List<Voucher>?> createVouchers({
    required String routerId,
    required String limitType,
    required int limitValue,
    required String limitUnit,
    int? validitySeconds,
    required int count,
    required double price,
  }) async {
    return _result;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

Voucher _makeVoucher({String? speedLimit}) => Voucher(
      id: 'v-1',
      userId: 'u-1',
      routerId: 'r-1',
      username: 'TEST-001',
      status: 'unused',
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
      speedLimit: speedLimit,
    );

Widget _buildApp({
  CardSpeedState? speedState,
  List<Voucher>? createResult,
  Locale? locale,
}) {
  final speedNotifier = _FakeCardSpeedNotifier(
    speedState ?? const CardSpeedState(),
  );
  return ProviderScope(
    overrides: [
      printSettingsProvider.overrideWith((_) => _FakePrintSettingsNotifier()),
      routersProvider.overrideWith((_) => _FakeRoutersNotifier()),
      vouchersProvider
          .overrideWith((_) => _FakeVouchersNotifier(result: createResult)),
      cardSpeedProvider.overrideWith((_) => speedNotifier),
    ],
    child: MaterialApp(
      theme: AppTheme.light,
      locale: locale,
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

Widget _buildAppWithRouter({
  CardSpeedState? speedState,
  Locale? locale,
}) {
  final speedNotifier = _FakeCardSpeedNotifier(
    speedState ?? const CardSpeedState(),
  );
  final router = GoRouter(
    initialLocation: '/wizard',
    routes: [
      GoRoute(
        path: '/wizard',
        builder: (context, state) => const CreateVoucherWizard(routerId: 'r-1'),
      ),
      GoRoute(
        path: '/settings/voucher-printing',
        builder: (context, state) => const Scaffold(body: Text('VoucherPrinting')),
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      printSettingsProvider.overrideWith((_) => _FakePrintSettingsNotifier()),
      routersProvider.overrideWith((_) => _FakeRoutersNotifier()),
      vouchersProvider.overrideWith((_) => _FakeVouchersNotifier()),
      cardSpeedProvider.overrideWith((_) => speedNotifier),
    ],
    child: MaterialApp.router(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      routerConfig: router,
    ),
  );
}

Future<void> _advanceToStep3(WidgetTester tester) async {
  final limitField = find.byType(TextFormField).first;
  await tester.enterText(limitField, '1');
  await tester.pump();
  await tester.tap(find.text('Next'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Next'));
  await tester.pumpAndSettle();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  setUpAll(() async {
    final loader = FontLoader('Cairo');
    for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
      loader.addFont(rootBundle.load('assets/fonts/Cairo-$weight.ttf'));
    }
    await loader.load();
  });

  group('Wizard step 3 — speed limit strip', () {
    testWidgets('limit on: step 3 shows the Speed row and the strip above Create',
        (tester) async {
      await tester.pumpWidget(_buildApp(
        speedState: CardSpeedState(
          setting: CardSpeedSetting(
              enabled: true, speed: '1M', options: const []),
        ),
      ));
      await tester.pumpAndSettle();

      await _advanceToStep3(tester);

      // Strip should be visible without scrolling (it's in the bottom bar)
      expect(find.byKey(const Key('speedLimitStrip')), findsOneWidget);

      // Strip text contains the speed
      expect(find.textContaining('1M'), findsWidgets);

      // Summary row with Speed label
      expect(find.text('Speed'), findsOneWidget);
    });

    testWidgets('the strip is not shown on steps 1 and 2', (tester) async {
      await tester.pumpWidget(_buildApp(
        speedState: CardSpeedState(
          setting: CardSpeedSetting(
              enabled: true, speed: '1M', options: const []),
        ),
      ));
      await tester.pumpAndSettle();

      // Step 1: no strip
      expect(find.byKey(const Key('speedLimitStrip')), findsNothing);

      // Step 2: no strip
      final limitField = find.byType(TextFormField).first;
      await tester.enterText(limitField, '1');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('speedLimitStrip')), findsNothing);
    });

    testWidgets('limit off: no strip and no Speed row', (tester) async {
      await tester.pumpWidget(_buildApp(
        speedState: CardSpeedState(
          setting: CardSpeedSetting(
              enabled: false, speed: '1M', options: const []),
        ),
      ));
      await tester.pumpAndSettle();

      await _advanceToStep3(tester);

      expect(find.byKey(const Key('speedLimitStrip')), findsNothing);
      expect(find.text('Speed'), findsNothing);
    });

    testWidgets(
        'setting not loaded (error or unavailable): no strip, no Speed row, Create still works',
        (tester) async {
      await tester.pumpWidget(_buildApp(
        speedState: const CardSpeedState(error: 'some error'),
      ));
      await tester.pumpAndSettle();

      await _advanceToStep3(tester);

      expect(find.byKey(const Key('speedLimitStrip')), findsNothing);
      expect(find.text('Speed'), findsNothing);

      // Create button still present
      expect(find.widgetWithText(ElevatedButton, 'Create Voucher'), findsOneWidget);
    });

    testWidgets(
        'load() is called when the wizard opens even if the provider already holds a value',
        (tester) async {
      final speedNotifier = _FakeCardSpeedNotifier(
        CardSpeedState(
          setting: CardSpeedSetting(
              enabled: true, speed: '2M', options: const []),
        ),
      );
      await tester.pumpWidget(ProviderScope(
        overrides: [
          printSettingsProvider
              .overrideWith((_) => _FakePrintSettingsNotifier()),
          routersProvider.overrideWith((_) => _FakeRoutersNotifier()),
          vouchersProvider.overrideWith((_) => _FakeVouchersNotifier()),
          cardSpeedProvider.overrideWith((_) => speedNotifier),
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
      ));
      await tester.pumpAndSettle();

      expect(speedNotifier.loadCalls, 1);
    });

    // M2: strip text contains speed, not truncated — English
    testWidgets('M2 strip text contains speed and is not truncated (English, 320 wide)',
        (tester) async {
      const dpr = 3.0;
      tester.view.physicalSize = const Size(320 * dpr, 800 * dpr);
      tester.view.devicePixelRatio = dpr;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(_buildApp(
        speedState: CardSpeedState(
          setting: CardSpeedSetting(enabled: true, speed: '1M', options: const []),
        ),
      ));
      await tester.pumpAndSettle();
      await _advanceToStep3(tester);

      final strip = find.byKey(const Key('speedLimitStrip'));
      expect(strip, findsOneWidget);

      // The Text inside the strip must contain the speed.
      final textWidget = tester.widget<Text>(
          find.descendant(of: strip, matching: find.byType(Text)).first);
      expect(textWidget.data ?? '', contains('1M'));

      // Must not be truncated.
      final renderParagraph = tester.renderObject<RenderParagraph>(
          find.descendant(of: strip, matching: find.byType(RichText)).first);
      expect(renderParagraph.didExceedMaxLines, isFalse);
    });

    // M2: strip text contains speed, not truncated — Arabic
    testWidgets('M2 strip text contains speed and is not truncated (Arabic, 320 wide)',
        (tester) async {
      const dpr = 3.0;
      tester.view.physicalSize = const Size(320 * dpr, 800 * dpr);
      tester.view.devicePixelRatio = dpr;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(_buildApp(
        speedState: CardSpeedState(
          setting: CardSpeedSetting(enabled: true, speed: '1M', options: const []),
        ),
        locale: const Locale('ar'),
      ));
      await tester.pumpAndSettle();

      final limitField = find.byType(TextFormField).first;
      await tester.enterText(limitField, '1');
      await tester.pump();
      await tester.tap(find.text('التالي'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('التالي'));
      await tester.pumpAndSettle();

      final strip = find.byKey(const Key('speedLimitStrip'));
      expect(strip, findsOneWidget);

      // Must contain the speed value.
      expect(find.descendant(of: strip, matching: find.textContaining('1')), findsWidgets);

      // Must not be truncated.
      final renderParagraph = tester.renderObject<RenderParagraph>(
          find.descendant(of: strip, matching: find.byType(RichText)).first);
      expect(renderParagraph.didExceedMaxLines, isFalse);
    });

    testWidgets('Change opens Voucher Printing', (tester) async {
      await tester.pumpWidget(_buildAppWithRouter(
        speedState: CardSpeedState(
          setting: CardSpeedSetting(
              enabled: true, speed: '1M', options: const []),
        ),
      ));
      await tester.pumpAndSettle();

      await _advanceToStep3(tester);

      await tester.tap(find.byKey(const Key('speedLimitChange')));
      await tester.pumpAndSettle();

      expect(find.text('VoucherPrinting'), findsOneWidget);
    });

    // M1(a): 320x569, keyboard 280 — strip hidden, no overflow, Create button above keyboard
    testWidgets('320x569 keyboard open: strip absent, Create button above keyboard',
        (tester) async {
      const dpr = 3.0;
      tester.view.physicalSize = const Size(320 * dpr, 569 * dpr);
      tester.view.devicePixelRatio = dpr;
      tester.view.padding = const FakeViewPadding(top: 24 * dpr);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPadding);
      addTearDown(() => tester.view.resetViewInsets());

      await tester.pumpWidget(_buildApp(
        speedState: CardSpeedState(
          setting: CardSpeedSetting(enabled: true, speed: '1M', options: const []),
        ),
        locale: const Locale('ar'),
      ));
      await tester.pumpAndSettle();

      final limitField = find.byType(TextFormField).first;
      await tester.enterText(limitField, '1');
      await tester.pump();
      await tester.tap(find.text('التالي'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('التالي'));
      await tester.pumpAndSettle();

      // Simulate keyboard opening.
      tester.view.viewInsets = const FakeViewPadding(bottom: 280 * dpr);
      await tester.pump();

      // Strip must be hidden.
      expect(find.byKey(const Key('speedLimitStrip')), findsNothing);
      expect(tester.takeException(), isNull);

      // Create button must be fully on screen, between the status bar and the
      // keyboard. It is the only ElevatedButton on step 3 (Back is outlined).
      final createBtn = find.byType(ElevatedButton);
      expect(createBtn, findsOneWidget);
      final rect = tester.getRect(createBtn);
      expect(rect.bottom, lessThanOrEqualTo(569 - 280));
      expect(rect.top, greaterThanOrEqualTo(24));
    });

    // M1(b): 320x569, keyboard closed — strip present, no overflow
    testWidgets('320x569 keyboard closed: strip present, no exception',
        (tester) async {
      const dpr = 3.0;
      tester.view.physicalSize = const Size(320 * dpr, 569 * dpr);
      tester.view.devicePixelRatio = dpr;
      tester.view.padding = const FakeViewPadding(top: 24 * dpr);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPadding);

      await tester.pumpWidget(_buildApp(
        speedState: CardSpeedState(
          setting: CardSpeedSetting(enabled: true, speed: '1M', options: const []),
        ),
        locale: const Locale('ar'),
      ));
      await tester.pumpAndSettle();

      final limitField = find.byType(TextFormField).first;
      await tester.enterText(limitField, '1');
      await tester.pump();
      await tester.tap(find.text('التالي'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('التالي'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('speedLimitStrip')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    // M1(c): 360x800, keyboard 300 — strip present (room = 800-300-24 = 476 >= 340)
    testWidgets('360x800 keyboard open 300: strip present, no exception',
        (tester) async {
      const dpr = 3.0;
      tester.view.physicalSize = const Size(360 * dpr, 800 * dpr);
      tester.view.devicePixelRatio = dpr;
      tester.view.padding = const FakeViewPadding(top: 24 * dpr);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPadding);
      addTearDown(() => tester.view.resetViewInsets());

      await tester.pumpWidget(_buildApp(
        speedState: CardSpeedState(
          setting: CardSpeedSetting(enabled: true, speed: '1M', options: const []),
        ),
        locale: const Locale('ar'),
      ));
      await tester.pumpAndSettle();

      final limitField = find.byType(TextFormField).first;
      await tester.enterText(limitField, '1');
      await tester.pump();
      await tester.tap(find.text('التالي'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('التالي'));
      await tester.pumpAndSettle();

      tester.view.viewInsets = const FakeViewPadding(bottom: 300 * dpr);
      await tester.pump();

      expect(find.byKey(const Key('speedLimitStrip')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('success dialog shows the speed the server applied',
        (tester) async {
      await tester.pumpWidget(_buildApp(
        speedState: CardSpeedState(
          setting: CardSpeedSetting(
              enabled: true, speed: '1M', options: const []),
        ),
        createResult: [_makeVoucher(speedLimit: '1M')],
      ));
      await tester.pumpAndSettle();

      await _advanceToStep3(tester);

      // Fill price field (the last TextFormField on the visible step)
      await tester.enterText(find.byType(TextFormField).last, '1.0');
      await tester.pump();

      await tester.tap(find.widgetWithText(ElevatedButton, 'Create Voucher'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('appliedSpeedText')), findsOneWidget);
      expect(find.textContaining('1M'), findsWidgets);
    });

    // M3: none + available → show "No limit"
    testWidgets('success dialog: no speed + available → shows No limit',
        (tester) async {
      await tester.pumpWidget(_buildApp(
        speedState: const CardSpeedState(
          setting: CardSpeedSetting(enabled: false, speed: '2M', options: []),
        ),
        createResult: [_makeVoucher()],
      ));
      await tester.pumpAndSettle();

      await _advanceToStep3(tester);

      await tester.enterText(find.byType(TextFormField).last, '1.0');
      await tester.pump();

      await tester.tap(find.widgetWithText(ElevatedButton, 'Create Voucher'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('appliedSpeedText')), findsOneWidget);
      expect(find.textContaining('No limit'), findsWidgets);
    });

    // M3: none + unavailable → show no speed line
    testWidgets('success dialog: no speed + unavailable → shows no speed line',
        (tester) async {
      await tester.pumpWidget(_buildApp(
        speedState: const CardSpeedState(unavailable: true),
        createResult: [_makeVoucher()],
      ));
      await tester.pumpAndSettle();

      await _advanceToStep3(tester);

      await tester.enterText(find.byType(TextFormField).last, '1.0');
      await tester.pump();

      await tester.tap(find.widgetWithText(ElevatedButton, 'Create Voucher'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('appliedSpeedText')), findsNothing);
    });

    testWidgets(
        'success dialog shows the applied speed even when the setting never loaded',
        (tester) async {
      await tester.pumpWidget(_buildApp(
        speedState: const CardSpeedState(),
        createResult: [_makeVoucher(speedLimit: '2M')],
      ));
      await tester.pumpAndSettle();

      await _advanceToStep3(tester);

      await tester.enterText(find.byType(TextFormField).last, '1.0');
      await tester.pump();

      await tester.tap(find.widgetWithText(ElevatedButton, 'Create Voucher'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('appliedSpeedText')), findsOneWidget);
      expect(find.textContaining('2M'), findsWidgets);
    });
  });

  // Voucher model speedLimit tests moved to mobile/test/models/voucher_test.dart.
}
