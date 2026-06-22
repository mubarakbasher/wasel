import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/widgets/inline_error_banner.dart';

/// Wraps [child] inside a [MaterialApp] that has full localisation support so
/// that [context.trOrRaw] can resolve i18n keys.
Widget _localizedApp(Widget child, {Locale locale = const Locale('en')}) {
  return MaterialApp(
    locale: locale,
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: const [
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    home: Scaffold(body: child),
  );
}

void main() {
  group('InlineErrorBanner – i18n key resolution', () {
    testWidgets('error.timeout resolves to EN string under Locale("en")',
        (tester) async {
      await tester.pumpWidget(
        _localizedApp(
          const InlineErrorBanner(message: 'error.timeout'),
          locale: const Locale('en'),
        ),
      );
      await tester.pumpAndSettle();

      // The EN translation for error.timeout
      const enTranslation = 'Request timed out. Please try again.';
      expect(find.text(enTranslation), findsOneWidget,
          reason: 'error.timeout should be resolved to the English string');
      expect(find.text('error.timeout'), findsNothing,
          reason: 'The raw key must not appear in the UI');
    });

    testWidgets('error.timeout resolves to AR string under Locale("ar")',
        (tester) async {
      await tester.pumpWidget(
        _localizedApp(
          const InlineErrorBanner(message: 'error.timeout'),
          locale: const Locale('ar'),
        ),
      );
      await tester.pumpAndSettle();

      const arTranslation = 'انتهت مهلة الطلب. يرجى المحاولة مرة أخرى.';
      expect(find.text(arTranslation), findsOneWidget,
          reason: 'error.timeout should resolve to the Arabic string');
      expect(find.text('error.timeout'), findsNothing,
          reason: 'The raw key must not appear in the UI');
    });

    testWidgets('a literal backend message renders unchanged', (tester) async {
      await tester.pumpWidget(
        _localizedApp(
          const InlineErrorBanner(message: 'Email already registered'),
          locale: const Locale('en'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Email already registered'), findsOneWidget,
          reason: 'Literal backend messages must pass through as-is');
    });
  });
}
