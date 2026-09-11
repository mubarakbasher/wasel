import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/screens/dashboard_screen.dart';
import 'package:wasel/theme/app_theme.dart';

/// The Dashboard has no widget-test harness (it needs the dashboard, routers
/// and notification providers plus GoRouter), so the pending-payment state is
/// covered through the pure card the screen renders for it.
Widget _host(Widget child, {Locale locale = const Locale('en')}) {
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

void main() {
  group('PaymentPendingCard', () {
    testWidgets('names the plan and offers the payment instructions',
        (tester) async {
      var taps = 0;

      await tester.pumpWidget(_host(
        PaymentPendingCard(
          planName: 'Starter',
          onViewInstructions: () => taps++,
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Payment pending for Starter'), findsOneWidget);
      expect(find.text('View Payment Instructions'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('View Payment Instructions'));
      await tester.pump();
      expect(taps, 1);
    });

    testWidgets('renders in Arabic without layout errors', (tester) async {
      await tester.pumpWidget(_host(
        PaymentPendingCard(
          planName: 'المبتدئة',
          onViewInstructions: () {},
        ),
        locale: const Locale('ar'),
      ));
      await tester.pumpAndSettle();

      expect(find.textContaining('المبتدئة'), findsOneWidget);
      expect(find.text('عرض تعليمات الدفع'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
