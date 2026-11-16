import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/models/card_speed_setting.dart';
import 'package:wasel/models/print_settings.dart';
import 'package:wasel/providers/card_speed_provider.dart';
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
// Fake CardSpeedNotifier — records save() calls; load() is a no-op.
// ---------------------------------------------------------------------------

class _FakeCardSpeedNotifier extends CardSpeedNotifier {
  final List<({bool enabled, String speed})> saves = [];

  _FakeCardSpeedNotifier(CardSpeedState initialState) {
    state = initialState;
  }

  @override
  Future<void> load() async {}

  @override
  Future<void> save({required bool enabled, required String speed}) async {
    saves.add((enabled: enabled, speed: speed));
    state = state.copyWith(
      setting: CardSpeedSetting(
        enabled: enabled,
        speed: speed,
        options: state.setting?.options ?? const [],
      ),
      clearError: true,
    );
  }
}

// ---------------------------------------------------------------------------
// Helper: pump the screen.
// ---------------------------------------------------------------------------

/// Default speed state: unavailable so existing tests are unaffected.
final _kUnavailableSpeed = const CardSpeedState(unavailable: true);

Widget _buildApp(
  PrintSettings settings, {
  CardSpeedState? speedState,
  Locale locale = const Locale('en'),
}) {
  final cs = speedState ?? _kUnavailableSpeed;
  return ProviderScope(
    overrides: [
      printSettingsProvider
          .overrideWith((_) => _FakePrintSettingsNotifier(settings)),
      thumbnailRendererProvider
          .overrideWithValue(_FakeThumbnailRenderer()),
      cardSpeedProvider
          .overrideWith((_) => _FakeCardSpeedNotifier(cs)),
    ],
    child: MaterialApp(
      locale: locale,
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
  setUpAll(() async {
    final loader = FontLoader('Cairo');
    for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
      loader.addFont(rootBundle.load('assets/fonts/Cairo-$weight.ttf'));
    }
    await loader.load();
  });

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

  // ── Card speed section ───────────────────────────────────────────────────

  group('VoucherPrintingScreen card speed section', () {
    testWidgets('speed section is hidden when backend does not offer it',
        (tester) async {
      await tester.pumpWidget(_buildApp(
        const PrintSettings(),
        speedState: const CardSpeedState(unavailable: true),
      ));
      await tester.pump();

      expect(find.byKey(const Key('cardSpeedSwitch')), findsNothing);
    });

    testWidgets('limit off shows the switch and no chips', (tester) async {
      final setting = CardSpeedSetting(
        enabled: false,
        speed: '2M',
        options: const ['256k', '512k', '1M', '2M', '3M', '4M', '5M', '10M'],
      );
      await tester.pumpWidget(_buildApp(
        const PrintSettings(),
        speedState: CardSpeedState(setting: setting),
      ));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
        find.byKey(const Key('cardSpeedSwitch'), skipOffstage: false),
        find.byType(ListView),
        const Offset(0, -200),
      );
      await tester.pump();

      expect(find.byKey(const Key('cardSpeedSwitch')), findsOneWidget);
      expect(
          find.byKey(const Key('cardSpeedChip_2M'), skipOffstage: false),
          findsNothing);
    });

    testWidgets(
        'limit on shows one chip per server option with saved speed selected and caption',
        (tester) async {
      final setting = CardSpeedSetting(
        enabled: true,
        speed: '2M',
        options: const ['256k', '512k', '1M', '2M', '3M', '4M', '5M', '10M'],
      );
      await tester.pumpWidget(_buildApp(
        const PrintSettings(),
        speedState: CardSpeedState(setting: setting),
      ));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
        find.byKey(const Key('cardSpeedChip_2M'), skipOffstage: false),
        find.byType(ListView),
        const Offset(0, -200),
      );
      await tester.pump();

      // 8 chips total
      for (final w in ['256k', '512k', '1M', '2M', '3M', '4M', '5M', '10M']) {
        expect(
            find.byKey(Key('cardSpeedChip_$w')), findsOneWidget,
            reason: 'chip for $w');
      }
      // The saved speed (2M) must be selected.
      final chip2M = tester.widget<ChoiceChip>(
          find.byKey(const Key('cardSpeedChip_2M')));
      expect(chip2M.selected, isTrue, reason: '2M chip must be selected');
      // All other chips must be unselected.
      for (final w in ['256k', '512k', '1M', '3M', '4M', '5M', '10M']) {
        final chip = tester.widget<ChoiceChip>(find.byKey(Key('cardSpeedChip_$w')));
        expect(chip.selected, isFalse, reason: '$w chip must not be selected');
      }
      // caption visible
      expect(find.byKey(const Key('cardSpeedCaption')), findsOneWidget);
      final captionWidget = tester.widget<Text>(
          find.byKey(const Key('cardSpeedCaption')));
      expect(captionWidget.data, contains('2M'));
    });

    testWidgets(
        'a saved speed not in options selects no chip and still shows in caption',
        (tester) async {
      final setting = CardSpeedSetting(
        enabled: true,
        speed: '8M',
        options: const ['256k', '512k', '1M', '2M', '3M', '4M', '5M', '10M'],
      );
      await tester.pumpWidget(_buildApp(
        const PrintSettings(),
        speedState: CardSpeedState(setting: setting),
      ));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
        find.byKey(const Key('cardSpeedCaption'), skipOffstage: false),
        find.byType(ListView),
        const Offset(0, -200),
      );
      await tester.pump();

      final captionWidget = tester.widget<Text>(
          find.byKey(const Key('cardSpeedCaption')));
      expect(captionWidget.data, contains('8M'));
      // No chip is selected
      final chips = tester.widgetList<ChoiceChip>(find.byType(ChoiceChip));
      expect(chips.any((ch) => ch.selected), isFalse);
    });

    testWidgets('tapping a chip saves enabled true with that speed',
        (tester) async {
      final setting = CardSpeedSetting(
        enabled: true,
        speed: '2M',
        options: const ['256k', '512k', '1M', '2M', '3M', '4M', '5M', '10M'],
      );
      late _FakeCardSpeedNotifier notifier;
      await tester.pumpWidget(ProviderScope(
        overrides: [
          printSettingsProvider.overrideWith(
              (_) => _FakePrintSettingsNotifier(const PrintSettings())),
          thumbnailRendererProvider
              .overrideWithValue(_FakeThumbnailRenderer()),
          cardSpeedProvider.overrideWith((_) {
            notifier = _FakeCardSpeedNotifier(CardSpeedState(setting: setting));
            return notifier;
          }),
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
      ));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
        find.byKey(const Key('cardSpeedChip_1M'), skipOffstage: false),
        find.byType(ListView),
        const Offset(0, -200),
      );
      await tester.pump();

      await tester.tap(find.byKey(const Key('cardSpeedChip_1M')));
      await tester.pump();

      expect(notifier.saves, hasLength(1));
      expect(notifier.saves.first.enabled, isTrue);
      expect(notifier.saves.first.speed, '1M');
    });

    // M4: switching on with speed not in options → sends '2M' (the default)
    testWidgets('M4 switching on with speed not in options sends 2M', (tester) async {
      final setting = CardSpeedSetting(
        enabled: false,
        speed: '8M',
        options: const ['256k', '512k', '1M', '2M', '3M', '4M', '5M', '10M'],
      );
      late _FakeCardSpeedNotifier notifier;
      await tester.pumpWidget(ProviderScope(
        overrides: [
          printSettingsProvider.overrideWith(
              (_) => _FakePrintSettingsNotifier(const PrintSettings())),
          thumbnailRendererProvider
              .overrideWithValue(_FakeThumbnailRenderer()),
          cardSpeedProvider.overrideWith((_) {
            notifier = _FakeCardSpeedNotifier(CardSpeedState(setting: setting));
            return notifier;
          }),
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
      ));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
        find.byKey(const Key('cardSpeedSwitch'), skipOffstage: false),
        find.byType(ListView),
        const Offset(0, -200),
      );
      await tester.pump();

      await tester.tap(find.byKey(const Key('cardSpeedSwitch')));
      await tester.pump();

      expect(notifier.saves, hasLength(1));
      expect(notifier.saves.first.enabled, isTrue);
      expect(notifier.saves.first.speed, '2M');
    });

    testWidgets('switching on sends the remembered speed', (tester) async {
      final setting = CardSpeedSetting(
        enabled: false,
        speed: '5M',
        options: const ['256k', '512k', '1M', '2M', '3M', '4M', '5M', '10M'],
      );
      late _FakeCardSpeedNotifier notifier;
      await tester.pumpWidget(ProviderScope(
        overrides: [
          printSettingsProvider.overrideWith(
              (_) => _FakePrintSettingsNotifier(const PrintSettings())),
          thumbnailRendererProvider
              .overrideWithValue(_FakeThumbnailRenderer()),
          cardSpeedProvider.overrideWith((_) {
            notifier = _FakeCardSpeedNotifier(CardSpeedState(setting: setting));
            return notifier;
          }),
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
      ));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
        find.byKey(const Key('cardSpeedSwitch'), skipOffstage: false),
        find.byType(ListView),
        const Offset(0, -200),
      );
      await tester.pump();

      await tester.tap(find.byKey(const Key('cardSpeedSwitch')));
      await tester.pump();

      expect(notifier.saves, hasLength(1));
      expect(notifier.saves.first.enabled, isTrue);
      expect(notifier.saves.first.speed, '5M');
    });

    testWidgets('switching off sends the current speed', (tester) async {
      final setting = CardSpeedSetting(
        enabled: true,
        speed: '1M',
        options: const ['256k', '512k', '1M', '2M', '3M', '4M', '5M', '10M'],
      );
      late _FakeCardSpeedNotifier notifier;
      await tester.pumpWidget(ProviderScope(
        overrides: [
          printSettingsProvider.overrideWith(
              (_) => _FakePrintSettingsNotifier(const PrintSettings())),
          thumbnailRendererProvider
              .overrideWithValue(_FakeThumbnailRenderer()),
          cardSpeedProvider.overrideWith((_) {
            notifier = _FakeCardSpeedNotifier(CardSpeedState(setting: setting));
            return notifier;
          }),
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
      ));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
        find.byKey(const Key('cardSpeedSwitch'), skipOffstage: false),
        find.byType(ListView),
        const Offset(0, -200),
      );
      await tester.pump();

      await tester.tap(find.byKey(const Key('cardSpeedSwitch')));
      await tester.pump();

      expect(notifier.saves, hasLength(1));
      expect(notifier.saves.first.enabled, isFalse);
      expect(notifier.saves.first.speed, '1M');
    });

    testWidgets('lays out at 320 px wide in Arabic without overflow',
        (tester) async {
      tester.view.physicalSize = const Size(320 * 3, 569 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final setting = CardSpeedSetting(
        enabled: true,
        speed: '2M',
        options: const ['256k', '512k', '1M', '2M', '3M', '4M', '5M', '10M'],
      );
      await tester.pumpWidget(_buildApp(
        const PrintSettings(),
        speedState: CardSpeedState(setting: setting),
        locale: const Locale('ar'),
      ));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });
  });
}
