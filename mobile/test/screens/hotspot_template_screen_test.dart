import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/models/hotspot_template.dart';
import 'package:wasel/models/router_model.dart';
import 'package:wasel/providers/hotspot_templates_provider.dart';
import 'package:wasel/providers/routers_provider.dart';
import 'package:wasel/screens/routers/hotspot_template_screen.dart';

// ---------------------------------------------------------------------------
// Fake notifier — records applyTemplate calls without touching the network.
// ---------------------------------------------------------------------------

class _FakeHotspotTemplateNotifier extends HotspotTemplateNotifier {
  final List<(String routerId, String templateId, String? accentColor)>
      calls = [];

  @override
  Future<RouterModel?> applyTemplate(
    String routerId,
    String templateId, {
    String? accentColor,
  }) async {
    calls.add((routerId, templateId, accentColor));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fake routers notifier — starts with a pre-seeded selected router.
// ---------------------------------------------------------------------------

class _FakeRoutersNotifier extends RoutersNotifier {
  _FakeRoutersNotifier(RouterModel router) {
    state = RoutersState(selectedRouter: router, routers: [router]);
  }

  @override
  Future<void> loadRouters() async {}

  @override
  Future<void> loadRouter(String id) async {}

  @override
  Future<void> loadRouterStatus(String id) async {}
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const _kRouterId = 'r-1';
const _kRouterName = 'Office Router';

final _tealPreset = AccentPreset(
  id: 'teal',
  hex: '#0f766e',
  nameEn: 'Teal',
  nameAr: 'تركوازي',
);
final _indigoPreset = AccentPreset(
  id: 'indigo',
  hex: '#4f46e5',
  nameEn: 'Indigo',
  nameAr: 'نيلي',
);

HotspotTemplate _fakeTemplate({String? id}) => HotspotTemplate(
      id: id ?? 'clean',
      name: 'Daylight',
      description: 'A clean design.',
      previewUrl: 'https://example.com/preview.png',
      defaultAccent: '#0f766e',
      accentPresets: [_tealPreset, _indigoPreset],
    );

RouterModel _fakeRouter({String? templateId, String? accentColor}) =>
    RouterModel(
      id: _kRouterId,
      userId: 'u-1',
      name: _kRouterName,
      status: 'online',
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
      hotspotTemplateId: templateId,
      hotspotAccentColor: accentColor,
    );

// ---------------------------------------------------------------------------
// Widget helper
// ---------------------------------------------------------------------------

Widget _buildApp({
  required _FakeHotspotTemplateNotifier notifier,
  RouterModel? router,
  List<HotspotTemplate>? templates,
  String routerName = _kRouterName,
  String? currentAccent,
}) {
  final theRouter = router ?? _fakeRouter();
  final theTemplates = templates ?? [_fakeTemplate()];

  return ProviderScope(
    overrides: [
      hotspotTemplatesProvider.overrideWith((ref) async => theTemplates),
      hotspotTemplateNotifierProvider.overrideWith(() => notifier),
      routersProvider.overrideWith(
        (ref) => _FakeRoutersNotifier(theRouter),
      ),
    ],
    child: MaterialApp(
      locale: const Locale('en'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: HotspotTemplateScreen(
        routerId: _kRouterId,
        routerName: routerName,
        currentAccent: currentAccent,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  late _FakeHotspotTemplateNotifier notifier;

  setUp(() {
    notifier = _FakeHotspotTemplateNotifier();
  });

  // ── Card tap opens sheet, does NOT immediately apply ───────────────────────

  testWidgets('tapping a card opens the bottom sheet without calling apply',
      (tester) async {
    await tester.pumpWidget(_buildApp(notifier: notifier));
    await tester.pumpAndSettle();

    // Confirm template card is present.
    expect(find.text('Daylight'), findsWidgets);

    // Tap the card.
    await tester.tap(find.text('Daylight').first);
    await tester.pumpAndSettle();

    // Sheet must be visible.
    expect(find.text('Apply design'), findsOneWidget);

    // Provider must NOT have been called yet.
    expect(notifier.calls, isEmpty);
  });

  // ── Sheet content ──────────────────────────────────────────────────────────

  testWidgets('sheet shows router name and rename caption', (tester) async {
    await tester.pumpWidget(_buildApp(notifier: notifier));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Daylight').first);
    await tester.pumpAndSettle();

    // Router name appears in the "Guests will see:" RichText.
    expect(
      find.byWidgetPredicate((w) =>
          w is RichText &&
          w.text.toPlainText().contains(_kRouterName)),
      findsWidgets,
    );
    // Rename caption is a plain Text widget.
    expect(
      find.text('Renaming the router requires re-applying the design.'),
      findsOneWidget,
    );
  });

  // ── Swatch selection ───────────────────────────────────────────────────────

  testWidgets('selecting a different swatch updates the selection',
      (tester) async {
    await tester.pumpWidget(_buildApp(notifier: notifier));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Daylight').first);
    await tester.pumpAndSettle();

    // Find swatches by Semantics label.
    final indigoFinder = find.bySemanticsLabel('Indigo');
    expect(indigoFinder, findsOneWidget);

    // Tap the indigo swatch.
    await tester.tap(indigoFinder);
    await tester.pump();

    // The indigo swatch widget should now carry selected=true Semantics.
    final semantics = tester.getSemantics(indigoFinder);
    expect(// ignore: deprecated_member_use
        semantics.hasFlag(SemanticsFlag.isSelected), isTrue);
  });

  // ── Apply calls the notifier with correct args ─────────────────────────────

  testWidgets('tapping Apply calls applyTemplate with routerId, templateId, and chosen accent',
      (tester) async {
    await tester.pumpWidget(_buildApp(notifier: notifier));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Daylight').first);
    await tester.pumpAndSettle();

    // Select indigo swatch.
    await tester.tap(find.bySemanticsLabel('Indigo'));
    await tester.pump();

    // Tap Apply.
    await tester.tap(find.text('Apply design'));
    await tester.pumpAndSettle();

    // Sheet should be gone.
    expect(find.text('Apply design'), findsNothing);

    // Provider was called once with the right args.
    expect(notifier.calls, hasLength(1));
    final (routerId, templateId, accentColor) = notifier.calls.first;
    expect(routerId, _kRouterId);
    expect(templateId, 'clean');
    expect(accentColor, '#4f46e5'); // indigo hex
  });

  // ── Cancel closes without applying ────────────────────────────────────────

  testWidgets('tapping Cancel closes the sheet without calling apply',
      (tester) async {
    await tester.pumpWidget(_buildApp(notifier: notifier));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Daylight').first);
    await tester.pumpAndSettle();

    expect(find.text('Apply design'), findsOneWidget);

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    // Sheet dismissed.
    expect(find.text('Apply design'), findsNothing);

    // Provider was never called.
    expect(notifier.calls, isEmpty);
  });

  // ── currentAccent preselects the matching swatch ───────────────────────────

  testWidgets('currentAccent preselects the matching swatch', (tester) async {
    await tester.pumpWidget(
      _buildApp(notifier: notifier, currentAccent: '#4f46e5'),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Daylight').first);
    await tester.pumpAndSettle();

    // Indigo swatch should be pre-selected.
    final semantics = tester.getSemantics(find.bySemanticsLabel('Indigo'));
    expect(// ignore: deprecated_member_use
        semantics.hasFlag(SemanticsFlag.isSelected), isTrue);
  });

  // ── currentAccent not in presets falls back to defaultAccent ──────────────

  testWidgets('unknown currentAccent falls back to template defaultAccent',
      (tester) async {
    await tester.pumpWidget(
      _buildApp(notifier: notifier, currentAccent: '#aabbcc'),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Daylight').first);
    await tester.pumpAndSettle();

    // Teal swatch (defaultAccent #0f766e) should be pre-selected.
    final semantics = tester.getSemantics(find.bySemanticsLabel('Teal'));
    expect(// ignore: deprecated_member_use
        semantics.hasFlag(SemanticsFlag.isSelected), isTrue);
  });
}
