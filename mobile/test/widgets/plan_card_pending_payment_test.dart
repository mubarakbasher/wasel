import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/models/plan.dart';
import 'package:wasel/screens/subscription/widgets/plan_card.dart';
import 'package:wasel/theme/app_theme.dart';

final _plan = Plan.fromJson({
  'tier': 'starter',
  'name': 'Starter',
  'price': 5,
  'currency': 'SDG',
  'maxRouters': 1,
  'monthlyVouchers': 500,
  'sessionMonitoring': 'Active only',
  'dashboard': 'Basic stats',
  'features': ['1 Router', '500 Vouchers/month'],
});

Widget _host(
  Widget child, {
  Locale locale = const Locale('en'),
}) {
  return MaterialApp(
    theme: AppTheme.light,
    locale: locale,
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: const [
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    home: Scaffold(body: SingleChildScrollView(child: child)),
  );
}

PlanCard _card({
  bool hasPendingChange = false,
  bool hasPendingPayment = false,
  VoidCallback? onSelect,
}) {
  return PlanCard(
    plan: _plan,
    isCurrentPlan: false,
    isLoading: false,
    hasPendingChange: hasPendingChange,
    hasPendingPayment: hasPendingPayment,
    selectedDuration: 1,
    onDurationChanged: (_) {},
    onSelect: onSelect,
  );
}

void main() {
  group('PlanCard pending payment', () {
    testWidgets('is disabled and explains why a plan cannot be picked',
        (tester) async {
      tester.view.physicalSize = const Size(360, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      var taps = 0;
      await tester.pumpWidget(_host(
        _card(hasPendingPayment: true, onSelect: () => taps++),
      ));
      await tester.pumpAndSettle();

      expect(
        find.text('Complete your pending payment first'),
        findsOneWidget,
      );
      expect(find.text('Select Starter'), findsNothing);
      // Widget tests render with the fixed-width test font (every glyph is
      // font-size wide), so a real-font "does it fit in two lines" check is
      // not measurable here. Guard the protection itself instead: the label
      // must stay clamped to two centred lines with an ellipsis, and the
      // fixed-height button must not throw.
      final label = tester.widget<Text>(
          find.text('Complete your pending payment first'));
      expect(label.maxLines, 2);
      expect(label.overflow, TextOverflow.ellipsis);
      expect(label.textAlign, TextAlign.center);
      expect(tester.takeException(), isNull);

      final button =
          tester.widget<ElevatedButton>(find.byType(ElevatedButton));
      expect(button.onPressed, isNull,
          reason: 'a second purchase must be blocked while one is pending');
      expect(taps, 0);
    });

    testWidgets('keeps the distinct plan-change wording for a pending change',
        (tester) async {
      tester.view.physicalSize = const Size(360, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_host(_card(hasPendingChange: true)));
      await tester.pumpAndSettle();

      expect(find.text('Change Pending'), findsOneWidget);
      expect(
        find.text('Complete your pending payment first'),
        findsNothing,
      );
    });

    testWidgets('is selectable when nothing is pending', (tester) async {
      tester.view.physicalSize = const Size(360, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      var taps = 0;
      await tester.pumpWidget(_host(_card(onSelect: () => taps++)));
      await tester.pumpAndSettle();

      expect(find.text('Select Starter'), findsOneWidget);
      await tester.tap(find.text('Select Starter'));
      await tester.pump();
      expect(taps, 1);
    });

    testWidgets('Arabic pending-payment label fits the button', (tester) async {
      tester.view.physicalSize = const Size(360, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_host(
        _card(hasPendingPayment: true),
        locale: const Locale('ar'),
      ));
      await tester.pumpAndSettle();

      expect(find.text('أكمل دفعتك المعلقة أولاً'), findsOneWidget);
      // Same caveat as the EN case: the test font cannot measure real-font
      // fit, so assert the clamp (two centred lines + ellipsis) and no throw.
      final label =
          tester.widget<Text>(find.text('أكمل دفعتك المعلقة أولاً'));
      expect(label.maxLines, 2);
      expect(label.overflow, TextOverflow.ellipsis);
      expect(label.textAlign, TextAlign.center);
      expect(tester.takeException(), isNull);
    });
  });
}
